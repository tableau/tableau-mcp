import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  APPLY_INSTRUCTION,
  type BinderResult,
  type BindingProposal,
  bindTemplate,
  type Blocker,
  DERIVATION_OVERRIDE_INSTRUCTION,
  type EscalateReason,
  resolveInSummary,
  type SchemaSummary,
  summarizeSchema,
  WATERFALL_ANCHOR_FIELD_RE,
  WATERFALL_ANCHOR_SLOT_ID,
  WATERFALL_ORDER_FIELD_RE,
} from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { classifyAskRoute, normalizeAskForMatch } from '../../../desktop/binder/route-spec.js';
import { activateSheetBestEffort } from '../../../desktop/commands/workbook/activateSheet.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import {
  planSortByFieldOnCategoricalAxis,
  planTopN,
  type SortDirection,
} from '../../../desktop/refine/refineWorksheet.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  buildInjectedWorkbookXml,
  classifyWorksheetReplaceTarget,
} from '../../../desktop/templates/injectTemplateCore.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import { ExecuteCommandError, ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import { decodeXmlEntities } from '../../../desktop/xmlElement.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
  type AuthorCalcInput,
  authorCalculationsInWorkbook,
} from '../data-source/authorCalcCore.js';
import {
  doneNextAction,
  jsonToolResult,
  type NextAction,
  prefillNextAction,
  type StructuredResult,
  withNextAction,
} from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
// The nested `proposal` mirrors the binder library's public data contract
// (`BindingProposal` / `PROPOSAL_OUTPUT_SCHEMA`) verbatim so a Call-1 `propose` payload
// round-trips into a Call-2 `proposal` unchanged. The schema (incl. the watch-class
// confidence-required + title-max-80 tightening) is SHARED with validate-proposal so the
// two tools cannot drift — see proposalSchema.ts.
import { proposalSchema } from './proposalSchema.js';
import { proposalSignature } from './proposalSignature.js';

const paramsSchema = {
  session: z.string().optional(),
  ask: z.string(),
  proposal: proposalSchema.optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  auto_apply: z.boolean().optional().describe('Apply when bound.'),
  target_worksheet: z.string().optional().describe('Existing sheet to replace; omit for new.'),
  calcs: z
    .array(
      z.object({
        caption: z.string(),
        formula: z.string(),
        datatype: z.string().optional(),
        role: z.string().optional(),
      }),
    )
    .optional()
    .describe('Pre-bind calcs.'),
};

/**
 * Result of one bind-template call: the binder outcome plus a plain-text next step.
 * When auto_apply performs (or attempts) a server-side apply, the applied fields are
 * present: `applied` + either `sheet_name`/`phase_ms` (success) or `apply_error`
 * (graceful fallback — the bound `args` are still intact).
 */
type BindTemplateToolResultBase = BinderResult & {
  guidance: string;
  authored_calcs?: string[];
  warnings?: string[];
  applied?: boolean;
  sheet_name?: string;
  phase_ms?: { bind: number; inject: number; apply: number };
  apply_error?: string;
};

/**
 * Trimmed shape returned ONLY on applied:true fast-path success (W60 spike lever 5 /
 * preamble P4). It keeps just what a rendered success needs and drops the args echo, the
 * ~170-token apply_instruction, apply_hint, and used_llm — those exist to enable a manual
 * second call that never happens once the server-side apply succeeds. The FULL shape is
 * preserved on applied:false / propose / escalate / error (the graceful-fallback contract
 * is sacred — the fallback chain still needs the bound args).
 */
type AppliedFastPathResult = {
  status: 'bound';
  applied: true;
  authored_calcs?: string[];
  warnings?: string[];
  sheet_name: string;
  phase_ms: { bind: number; inject: number; apply: number };
  guidance: string;
};

type BlockedBindTemplateResult = {
  status: 'blocked';
  reason:
    | 'awaiting_proposal'
    | 'unchanged_proposal'
    | 'retry_budget_exhausted'
    | 'fallback_required';
  guidance: string;
};

type BindTemplateToolResult =
  | BindTemplateToolResultBase
  | AppliedFastPathResult
  | BlockedBindTemplateResult;
type StructuredBindTemplateToolResult = StructuredResult<BindTemplateToolResult>;

/** Escalation reasons that route back to the general (non-fast-path) authoring flow. */
const TIER2_REASONS: ReadonlySet<EscalateReason> = new Set<EscalateReason>([
  'not-fast-path',
  'missing-required-slot',
  'calc-dependency-unmet',
  'template-not-found',
  'kind-mismatch',
  'derivation-illegal',
  'base-column-conflict',
  'cross-datasource-binding',
  // Schema exceeds the classifier's field cap (M10 Finding 3): not a fast-path bind —
  // route to the general authoring flow.
  'schema-too-large',
]);
const WATERFALL_TEMPLATE = 'part-to-whole-waterfall';
const WATERFALL_ANCHOR_MAPPING_KEY = 'Anchor Category';
// WATERFALL_ANCHOR_SLOT_ID / WATERFALL_ANCHOR_FIELD_RE and WATERFALL_ORDER_FIELD_RE are all
// imported from binder.ts — ONE definition each, shared with the binder's deterministic
// anchor- and sort-defaults so the hint side and the apply side can never drift. A P&L/bridge running total is order-dependent and its intended
// order is usually a non-displayed sequence field; the hint names it so the singer carries it
// in the ORIGINAL bind (proposal.sort) instead of giving up on refine or falling to XML surgery.
const WATERFALL_SORT_HINT =
  'Waterfall default sort is DESC by the bound measure; override with proposal.sort:{by:<field>,direction:"asc"|"desc"} IN THE BIND — refine-worksheet cannot sort by a field that is not on the view.';
// Terminal stop-clause appended to the applied:true receipt when NO re-bind slot is unfilled
// (Blake's spiral): the model reads guidance verbatim, so this directly contradicts the
// bundled skill's "adapt fields/formatting" + the ambient "search-commands available" pulls.
// Paired with structuredContent.nextAction{kind:'done'} for a future route-gate/host.
const TERMINAL_GUIDANCE = 'Done — no further tool calls needed.';
const PROPOSAL_ATTEMPTED_PHASE = ['proposal', 'attempted'].join('-');
const RETRY_USED_PHASE = ['retry', 'used'].join('-');

function blockedResult(
  reason: BlockedBindTemplateResult['reason'],
  guidance: string,
  nextActionLabel: string,
): StructuredBindTemplateToolResult {
  return withNextAction(
    { status: 'blocked', reason, guidance },
    prefillNextAction(nextActionLabel),
  );
}

function recoveryGateBlock(
  record: ReturnType<typeof sessionRouteState.getBindRecovery>,
  currentProposalSignature: string | undefined,
): StructuredBindTemplateToolResult | undefined {
  if (!record) {
    return undefined;
  }

  if (record.phase === 'terminal') {
    return blockedResult(
      'fallback_required',
      'Blocked: bind-template already determined this ask is not recoverable in the fast path. Use build-and-apply-worksheet, or place fields stepwise with add-field then apply-worksheet; ask-user only if the fallback path needs a user decision.',
      'Use fallback authoring path',
    );
  }

  if (currentProposalSignature === undefined) {
    return blockedResult(
      'awaiting_proposal',
      'Blocked: bind-template already returned a proposal request for this ask. Choose one proposal from the previous llm_input and call bind-template with {session, ask, proposal}; otherwise ask-user or use build-and-apply-worksheet.',
      'Pick a proposal or ask user',
    );
  }

  if (record.phase === RETRY_USED_PHASE) {
    return blockedResult(
      'retry_budget_exhausted',
      'Blocked: the single changed proposal retry for this ask is already consumed. Stop retrying bind-template; ask-user if more information is needed, or use build-and-apply-worksheet.',
      'Use fallback path or ask user',
    );
  }

  if (
    record.phase === PROPOSAL_ATTEMPTED_PHASE &&
    record.lastProposalSignature === currentProposalSignature
  ) {
    return blockedResult(
      'unchanged_proposal',
      'Blocked: this proposal is semantically unchanged from the failed bind attempt. Title/confidence only changes do not count; change a binding, derivation, sort, or top_n based on evidence, otherwise ask-user or use build-and-apply-worksheet.',
      'Change proposal or ask user',
    );
  }

  return undefined;
}

function nextActionForEscalation(reason: EscalateReason): NextAction {
  if (reason === 'ambiguous-field' || reason === 'field-not-found') {
    return prefillNextAction('Resolve the fields first; otherwise ask the user');
  }
  if (reason === 'low-confidence') {
    return prefillNextAction('Pick a higher-confidence proposal');
  }
  if (TIER2_REASONS.has(reason)) {
    return prefillNextAction('Build via build-and-apply-worksheet');
  }
  return prefillNextAction('Build manually with worksheet tools');
}

function renderBlockers(blockers: Blocker[]): string {
  if (blockers.length === 0) {
    return 'none';
  }
  return blockers
    .map((b) => {
      const slot = b.slot_id ? ` slot '${b.slot_id}'` : '';
      const cands =
        b.candidates && b.candidates.length > 0 ? ` (candidates: ${b.candidates.join(', ')})` : '';
      return `[${b.code}]${slot} ${b.detail}${cands}`;
    })
    .join('; ');
}

function renderEscalationGuidance(reason: EscalateReason, blockers: Blocker[]): string {
  let next: string;
  const outcome = TIER2_REASONS.has(reason)
    ? 'Fast-path template bind did not apply; direct authoring is available.'
    : 'No worksheet was produced.';
  if (reason === 'ambiguous-field' || reason === 'field-not-found') {
    next =
      'Resolve the field(s) with the resolve-field tool, then call bind-template again with a corrected proposal; otherwise ask the user with ask-user (present the candidates).';
  } else if (reason === 'low-confidence') {
    next =
      'Confidence was below the floor. Re-examine the candidate template(s), pick the best fit, and re-propose with higher confidence.';
  } else if (TIER2_REASONS.has(reason)) {
    next =
      'No fast-path template fits this ask/data - build it directly: build-and-apply-worksheet ' +
      'does one validated build+apply, or place fields stepwise with add-field then ' +
      'apply-worksheet, then refine-worksheet for top-N/sort. This is a normal path, not a ' +
      'failure. If the inject-template/apply-workbook tools are available and a blocker names ' +
      'a real template, that template can still be applied via: get workbook structure in ' +
      'file mode -> inject-template (that template_name + an explicit field_mapping) -> apply-workbook.';
  } else {
    next = 'Author the worksheet with the general build tools instead.';
  }
  return `Escalated (${reason}). ${outcome} Blockers: ${renderBlockers(blockers)}. Next: ${next}`;
}

function isWaterfallResult(res: BinderResult): boolean {
  if (res.status === 'bound') {
    return res.args.template_name === WATERFALL_TEMPLATE;
  }
  if (res.status === 'propose') {
    return res.llm_input.candidate_templates.some(
      (candidate) => candidate.template === WATERFALL_TEMPLATE,
    );
  }
  return false;
}

function hasAnchorCategoryBinding(res: BinderResult, proposal?: BindingProposal): boolean {
  if (res.status === 'bound') {
    return Object.prototype.hasOwnProperty.call(
      res.args.field_mapping,
      WATERFALL_ANCHOR_MAPPING_KEY,
    );
  }
  return (
    proposal?.bindings.some((binding) => binding.slot_id === WATERFALL_ANCHOR_SLOT_ID) ?? false
  );
}

function hasSortOverride(res: BinderResult, proposal?: BindingProposal): boolean {
  if (res.status === 'bound') {
    return res.args.sort !== undefined;
  }
  return proposal?.sort !== undefined;
}

function waterfallAnchorCandidates(schemaSummary?: SchemaSummary): string[] {
  if (!schemaSummary) {
    return [];
  }
  const candidates = schemaSummary.fields
    .filter(
      (field) =>
        field.role === 'dimension' &&
        (field.datatype === 'string' || field.type === 'nominal') &&
        WATERFALL_ANCHOR_FIELD_RE.test(field.name),
    )
    .map((field) => field.name);
  return [...new Set(candidates)];
}

/** Explicit sequence/order columns (display_order, sort_order, …) usable as the step order. */
function waterfallOrderCandidates(schemaSummary?: SchemaSummary): string[] {
  if (!schemaSummary) {
    return [];
  }
  const candidates = schemaSummary.fields
    .filter((field) => WATERFALL_ORDER_FIELD_RE.test(field.name))
    .map((field) => field.name);
  return [...new Set(candidates)];
}

function buildWaterfallDiscoveryGuidance(
  res: BinderResult,
  schemaSummary?: SchemaSummary,
  proposal?: BindingProposal,
): string[] {
  if (!isWaterfallResult(res)) {
    return [];
  }
  const sentences: string[] = [];
  if (!hasAnchorCategoryBinding(res, proposal)) {
    const candidates = waterfallAnchorCandidates(schemaSummary);
    if (candidates.length > 0) {
      // Imperative, evidence-grounded: a category/row-type column means the P&L data almost
      // certainly carries subtotal/total rows, which a running total WILL double-count. Do
      // not offer this as an option or ask the user — a hedged "let me know if…" leaves the
      // bridge wrong (m1 recurring miss). Bind it now; unbinding is trivial if the data is flat.
      sentences.push(
        `Waterfall: schema has ${candidates.join(', ')} — a row-type column means this P&L data ` +
          'almost certainly has subtotal/total rows that the running total WILL double-count. ' +
          `Re-bind NOW with proposal.bindings += {slot_id:"${WATERFALL_ANCHOR_SLOT_ID}",field:${JSON.stringify(
            candidates[0],
          )}} to exclude them; do NOT ask the user or leave it unbound.`,
      );
    }
  }
  if (!hasSortOverride(res, proposal)) {
    const orderCandidates = waterfallOrderCandidates(schemaSummary);
    if (orderCandidates.length > 0) {
      // Name the sequence column so the singer carries it in the bind instead of failing on
      // refine (which cannot sort by an off-view field) — the m1 give-up/XML-surgery seam.
      sentences.push(
        `Waterfall step order: schema has ${orderCandidates.join(', ')}; the running total is ` +
          `order-dependent, so re-call bind-template with proposal.sort:{by:${JSON.stringify(
            orderCandidates[0],
          )},direction:"asc"} to set the sequence in ONE bind. Do NOT use refine-worksheet — it ` +
          'cannot sort by a field that is not on the view.',
      );
    } else {
      sentences.push(WATERFALL_SORT_HINT);
    }
  }
  return sentences;
}

function appendWaterfallDiscoveryGuidance(
  guidance: string,
  res: BinderResult,
  schemaSummary?: SchemaSummary,
  proposal?: BindingProposal,
): string {
  const additions = buildWaterfallDiscoveryGuidance(res, schemaSummary, proposal);
  return additions.length > 0 ? `${guidance} ${additions.join(' ')}` : guidance;
}

/**
 * True iff this applied waterfall bind still has a NAMED, fillable re-bind slot (an anchor
 * category candidate or an explicit order column) — the m1 genuine-unfilled case that MUST
 * keep steering a re-bind. It is the exact complement of "terminal": the applied:true receipt
 * is only marked done when this is false. Built from the SAME four helpers the steer uses so
 * the two sides cannot drift. The gray-zone waterfall whose only emission would be the bare
 * WATERFALL_SORT_HINT (no named order column) is deliberately NOT unfilled here — matching the
 * cartographer's boundary: steer ⟺ a named candidate field is actually fillable.
 */
function waterfallReBindSlotUnfilled(res: BinderResult, schemaSummary?: SchemaSummary): boolean {
  if (!isWaterfallResult(res)) {
    return false;
  }
  const anchorUnfilled =
    !hasAnchorCategoryBinding(res) && waterfallAnchorCandidates(schemaSummary).length > 0;
  const orderUnfilled = !hasSortOverride(res) && waterfallOrderCandidates(schemaSummary).length > 0;
  return anchorUnfilled || orderUnfilled;
}

function buildGuidance(
  res: BinderResult,
  schemaSummary?: SchemaSummary,
  proposal?: BindingProposal,
): string {
  let guidance: string;
  switch (res.status) {
    case 'bound':
      guidance = res.apply_instruction || APPLY_INSTRUCTION;
      break;
    case 'propose':
      guidance =
        'No deterministic (no-LLM) match. Choose exactly one template from llm_input.candidate_templates, ' +
        'bind every bindable slot to a field from llm_input.fields (match role/kind; use the exact field name), ' +
        'then call bind-template again with { session, ask, proposal } matching output_schema. ' +
        // W60 pie-anyway gap: candidates carry ONLY fast-path-eligible templates, so an ask naming an
        // unstamped shape (canonically pie) dead-ended here with no honest route — name both exits.
        'If the asked viz shape is not among the candidates (e.g. pie/donut — no pie template is ' +
        'fast-path eligible), do not force a mismatched proposal: bind the nearest candidate and tell the ' +
        'user in one sentence why (for a pie ask, a sorted bar or treemap compares shares more precisely); ' +
        'if they explicitly want the exact shape anyway, build it with build-and-apply-worksheet; or, if the ' +
        "inject-template/apply-workbook tools are available, inject-template with template_name 'part-to-whole-pie-chart' " +
        '(field_mapping: Region -> the category dimension, Sales -> the measure) -> apply-workbook. ' +
        `${DERIVATION_OVERRIDE_INSTRUCTION}.`;
      break;
    case 'escalate':
      guidance = renderEscalationGuidance(res.reason, res.blockers);
      break;
  }
  return appendWaterfallDiscoveryGuidance(guidance, res, schemaSummary, proposal);
}

/** Human-readable detail for a loadWorkbookXml failure, used in the apply-error text. */
function describeApplyError(
  error:
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError },
): string {
  if (error.type === 'load-workbook-xml-error') {
    const inner = error.error;
    if (inner.type === 'validation-failed') {
      return `preflight validation failed: ${inner.issues.map((i) => i.message).join('; ')}`;
    }
    if (inner.type === 'load-rejected') {
      return `Tableau rejected the load: ${inner.message}`;
    }
    return 'invalid workbook content';
  }
  return `workbook load command failed: ${JSON.stringify(error.error)}`;
}

type BoundResult = Extract<BinderResult, { status: 'bound' }>;

function sortDirectionForApply(direction: 'asc' | 'desc'): SortDirection {
  return direction === 'desc' ? 'DESC' : 'ASC';
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function bareColumnName(columnName: string): string {
  return columnName.replace(/^\[|\]$/g, '');
}

function parseQualifiedColumnInstance(
  columnRef: string,
): { datasource: string; instanceName: string; deriv: string; field: string; role: string } | null {
  const match = columnRef.match(/^\[([^\]]+)\]\.\[([^:]+):([^:]+):([^\]]+)\]$/);
  if (!match) return null;
  return {
    datasource: match[1],
    instanceName: `[${match[2]}:${match[3]}:${match[4]}]`,
    deriv: match[2],
    field: match[3],
    role: match[4],
  };
}

function derivationAttribute(deriv: string): string {
  if (deriv === 'sum') return 'Sum';
  if (deriv === 'usr') return 'User';
  if (deriv === 'none') return 'None';
  return deriv.charAt(0).toUpperCase() + deriv.slice(1);
}

function typeForRole(role: string): string {
  if (role === 'qk') return 'quantitative';
  if (role === 'ok') return 'ordinal';
  return 'nominal';
}

function ensureSortByColumnDependency(
  xml: string,
  field: NonNullable<ReturnType<typeof resolveInSummary>['field']>,
): { ok: true; xml: string; columnRef: string } | { ok: false; reason: string } {
  const parsed = parseQualifiedColumnInstance(field.column_ref);
  if (!parsed) {
    return {
      ok: false,
      reason: `sort field "${field.name}" did not resolve to a column-instance ref`,
    };
  }

  const columnName = bareColumnName(field.columnName);
  const columnDeclared = new RegExp(
    `<column\\s[^>]*\\bname=(['"])\\[${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\1`,
  ).test(xml);
  const instanceDeclared =
    xml.includes(`name='${parsed.instanceName}'`) || xml.includes(`name="${parsed.instanceName}"`);
  if (columnDeclared && instanceDeclared) {
    return { ok: true, xml, columnRef: field.column_ref };
  }

  const declarations: string[] = [];
  if (!columnDeclared) {
    declarations.push(
      `<column datatype='${escapeXmlAttribute(field.datatype)}' name='[${escapeXmlAttribute(
        columnName,
      )}]' role='${field.role}' type='${escapeXmlAttribute(field.type)}' />`,
    );
  }
  if (!instanceDeclared) {
    declarations.push(
      `<column-instance column='[${escapeXmlAttribute(columnName)}]' derivation='${derivationAttribute(
        parsed.deriv,
      )}' name='${escapeXmlAttribute(parsed.instanceName)}' pivot='key' type='${typeForRole(
        parsed.role,
      )}' />`,
    );
  }

  const out = xml.replace(
    /^([ \t]*)(<column-instance\b)/m,
    (_whole, indent: string, columnInstance: string) =>
      `${indent}${declarations.join(`\n${indent}`)}\n${indent}${columnInstance}`,
  );
  if (out === xml) {
    return {
      ok: false,
      reason: `could not declare sort field "${field.name}" in datasource-dependencies`,
    };
  }
  return { ok: true, xml: out, columnRef: field.column_ref };
}

function applyProposalSplices({
  xml,
  args,
  schemaSummary,
}: {
  xml: string;
  args: BoundResult['args'];
  schemaSummary: SchemaSummary;
}): { ok: true; xml: string; warnings: string[] } | { ok: false; reason: string } {
  let out = xml;
  const warnings: string[] = [];
  if (args.sort) {
    const sortField = resolveInSummary(schemaSummary, args.sort.by);
    if (sortField.kind !== 'exact' && sortField.kind !== 'rewritten') {
      const sorted = planSortByFieldOnCategoricalAxis(out, {
        sortByField: args.sort.by,
        direction: sortDirectionForApply(args.sort.direction),
      });
      if (!sorted.ok) {
        warnings.push(
          `sort splice skipped: no unique field named "${args.sort.by}"; kept the template's default sort`,
        );
      } else {
        out = sorted.xml;
      }
    } else if (!sortField.field) {
      warnings.push(
        `sort splice skipped: no field named "${args.sort.by}"; kept the template's default sort`,
      );
    } else {
      const withSortDependency = ensureSortByColumnDependency(out, sortField.field);
      if (!withSortDependency.ok) {
        warnings.push(`${withSortDependency.reason}; kept the template's default sort`);
      } else {
        const sorted = planSortByFieldOnCategoricalAxis(withSortDependency.xml, {
          sortByField: args.sort.by,
          sortByColumnRef: withSortDependency.columnRef,
          direction: sortDirectionForApply(args.sort.direction),
        });
        if (!sorted.ok) {
          warnings.push(`sort splice failed: ${sorted.reason}; kept the template's default sort`);
        } else {
          out = sorted.xml;
        }
      }
    }
  }
  if (args.top_n !== undefined) {
    const filtered = planTopN(out, { n: args.top_n });
    if (!filtered.ok) return { ok: false, reason: `top_n splice failed: ${filtered.reason}` };
    out = filtered.xml;
  }
  return { ok: true, xml: out, warnings };
}

/**
 * Build the graceful-fallback result: the bound args are intact + why apply didn't run.
 * Default guidance points at the manual inject/apply chain using the returned args — that
 * is correct for inject/validation/apply failures (the workbook was not the problem). The
 * events-dirty branch passes a custom `guidance` that DROPS the "apply the returned args
 * manually" alternative, because there the args are stale pre-edit values and re-applying
 * them would revert the user's changes (adversary P1-5).
 */
function applyFallback(
  base: BindTemplateToolResultBase,
  apply_error: string,
  guidance?: string,
): BindTemplateToolResultBase {
  const calcPrefix = renderAuthoredCalcPrefix(base.authored_calcs, base.status);
  return {
    ...base,
    guidance:
      guidance ??
      `${calcPrefix}Server-side auto-apply did not complete (${apply_error}). The bound args are intact — fall back to build-and-apply-worksheet using the returned args; or, if the inject-template/apply-workbook tools are available, the template chain: get workbook structure in file mode → inject-template → apply-workbook.`,
    applied: false,
    apply_error,
  };
}

/**
 * Server-side collapse of the proven STAMPED path: inject the bound template into
 * the live workbook (shared inject core) and apply it through the SAME validated
 * apply path (loadWorkbookXml runs the runValidation preflight before dispatch).
 * Any inject/apply failure returns the bound args intact via {@link applyFallback}
 * so no bind is ever lost.
 */
async function performAutoApply({
  res,
  base,
  workbookXml,
  session,
  executor,
  signal,
  bindMs,
  eventsAnchor,
  schemaSummary,
  manifest,
}: {
  res: BoundResult;
  base: BindTemplateToolResultBase;
  workbookXml: string;
  session: string;
  executor: ToolExecutor;
  signal: AbortSignal;
  bindMs: number;
  eventsAnchor?: number;
  schemaSummary: SchemaSummary;
  manifest: TemplateManifest;
}): Promise<StructuredBindTemplateToolResult> {
  const { args } = res;

  // ── Events-clean gate (W60 blind-spot #1) ────────────────────────
  // Refuse to auto-apply over a workbook the USER touched after our read: the
  // apply is whole-document last-writer-wins, so proceeding would silently
  // revert their edits. Fallback keeps the bind (args intact) so the agent can
  // re-get and re-apply deliberately. Gate is best-effort: no anchor (executor
  // without event support) proceeds — noted for the Athena transport, whose
  // events endpoint does not exist yet.
  if (eventsAnchor !== undefined) {
    const events = await executor.getEvents({ signal, sinceSequence: eventsAnchor });
    if (events.isOk() && events.value.count > 0) {
      return applyFallback(
        base,
        `user changed the workbook during the bind (${events.value.count} event(s) since read) — ` +
          're-run bind-template for a fresh read',
        // Events-dirty guidance DROPS the manual-apply alternative (P1-5): the bound args
        // were computed against the pre-edit workbook, so re-applying them would revert
        // the user's changes — the only safe recovery is a fresh read via bind-template.
        appendWaterfallDiscoveryGuidance(
          'Server-side auto-apply was refused: the user changed the workbook after it was read ' +
            `(${events.value.count} event(s) since read). Re-run bind-template so it reads the ` +
            'current workbook — do NOT re-apply the returned args, they were computed against ' +
            'the pre-edit workbook and would revert their changes.',
          res,
          schemaSummary,
        ),
      );
    }
  }

  // ── Inject leg (shared core) ─────────────────────────────────────
  const injectStart = Date.now();
  let injected: ReturnType<typeof buildInjectedWorkbookXml>;
  try {
    // SEA-aware template read (#433 seam): embedded asset in a SEA binary, disk otherwise.
    const templateXml = readTemplate(args.template_name);
    if (!templateXml) {
      throw new Error(`template "${args.template_name}" not found in template assets`);
    }
    // Per-apply calc-namespacing identity: session + apply timestamp (randomUUID
    // guards same-millisecond applies), mirroring the inject-template tool's nonce.
    const applyNonce = `${session}:${Date.now()}:${randomUUID()}`;
    injected = buildInjectedWorkbookXml({
      workbookXml,
      templateXml,
      title: args.title,
      sheetType: args.sheet_type,
      templateParameters: args.template_parameters,
      fieldMapping: args.field_mapping,
      templateSlots: manifest.slots,
      applyNonce,
      optionalFieldPrunes: args.optional_field_prunes,
      dateparseAxis: args.dateparse_axis,
    });
  } catch (err) {
    return applyFallback(base, `inject failed: ${getExceptionMessage(err)}`);
  }
  if (!injected.ok) {
    return applyFallback(base, `inject failed: ${injected.issues.join('; ')}`);
  }
  const spliced = applyProposalSplices({ xml: injected.xml, args, schemaSummary });
  if (!spliced.ok) {
    return applyFallback(base, spliced.reason);
  }
  if (spliced.warnings.length > 0) {
    base.warnings = [...(base.warnings ?? []), ...spliced.warnings];
  }
  const injectMs = Date.now() - injectStart;

  // ── Apply leg (SAME validated path; runValidation preflight runs) ─
  const literalTitle = decodeXmlEntities(args.title);
  const applyStart = Date.now();
  const applyResult = await loadWorkbookXml({
    xml: spliced.xml,
    executor,
    signal,
  });
  if (applyResult.isErr()) {
    return applyFallback(base, `apply failed: ${describeApplyError(applyResult.error)}`);
  }
  // Activation policy signal: this is the public standalone plain-chart auto-apply
  // boundary. Dashboard composition binds/injects its intermediate sheets internally
  // and never enters this path, so only the requested standalone chart navigates.
  await activateSheetBestEffort({
    sheetName: literalTitle,
    executor,
    signal,
  });
  const applyMs = Date.now() - applyStart;

  // W60 response-shape trim (P4): on success, return ONLY the trimmed fast-path shape —
  // drop the args echo, apply_instruction, apply_hint, and used_llm from `base`. Those
  // enable a manual second call that never happens once the apply succeeds.
  const calcPrefix = renderAuthoredCalcPrefix(base.authored_calcs, res.status);
  const receipt = `${calcPrefix}Applied "${literalTitle}" to the live workbook (bind ${bindMs}ms, inject ${injectMs}ms, apply ${applyMs}ms).`;
  // Blake's spiral fix: the applied:true receipt is TERMINAL unless a genuine, named re-bind
  // slot is still unfilled (the m1 waterfall case). On INCOMPLETE we keep today's steer and
  // attach NO structuredContent (byte-for-byte identical to the pre-fix code). On COMPLETE we
  // append the stop-clause AND the machine-readable done marker so nothing re-asserts "keep going".
  const incomplete = waterfallReBindSlotUnfilled(res, schemaSummary);
  const guidance = incomplete
    ? appendWaterfallDiscoveryGuidance(receipt, res, schemaSummary)
    : `${receipt} ${TERMINAL_GUIDANCE}`;
  const applied: AppliedFastPathResult = {
    status: res.status,
    ...(base.authored_calcs ? { authored_calcs: base.authored_calcs } : {}),
    ...(base.warnings && base.warnings.length > 0 ? { warnings: base.warnings } : {}),
    guidance,
    applied: true,
    sheet_name: literalTitle,
    phase_ms: { bind: bindMs, inject: injectMs, apply: applyMs },
  };
  return incomplete ? applied : withNextAction(applied, doneNextAction());
}

function renderAuthoredCalcPrefix(
  captions: string[] | undefined,
  status: BindTemplateToolResult['status'],
): string {
  return captions && captions.length > 0
    ? `Calcs authored: ${captions.join(', ')}. Bind outcome: ${status}. `
    : '';
}

function annotateAuthoredCalcs<T extends StructuredBindTemplateToolResult>(
  result: T,
  captions: string[],
): T {
  if (captions.length === 0) {
    return result;
  }
  return {
    ...result,
    authored_calcs: captions,
    guidance: `${renderAuthoredCalcPrefix(captions, result.status)}${result.guidance}`,
  };
}

function recordBindRecoveryAttemptFailOpen({
  session,
  askKey,
  outcome,
  currentProposalSignature,
  reservationId,
  terminal = false,
  terminalFallback = false,
}: {
  session: string;
  askKey: string;
  outcome: BinderResult['status'];
  currentProposalSignature?: string;
  reservationId?: number;
  terminal?: boolean;
  terminalFallback?: boolean;
}): void {
  try {
    const attempt = {
      outcome,
      ...(currentProposalSignature !== undefined
        ? { proposalSignature: currentProposalSignature }
        : {}),
      ...(reservationId !== undefined ? { reservationId } : {}),
    };
    if (outcome === 'escalate' && currentProposalSignature === undefined && !terminalFallback) {
      sessionRouteState.clearBindRecovery(session, askKey);
      return;
    }
    if (terminalFallback) {
      sessionRouteState.recordBindRecoveryTerminal(session, askKey, attempt);
      return;
    }
    sessionRouteState.recordBindRecoveryAttempt(session, askKey, {
      ...attempt,
      ...(terminal ? { terminal: true } : {}),
    });
  } catch {
    /* fail-open */
  }
}

function recordBoundRecoveryAfterFinalResult({
  session,
  askKey,
  currentProposalSignature,
  reservationId,
  result,
}: {
  session: string;
  askKey: string;
  currentProposalSignature?: string;
  reservationId?: number;
  result: StructuredBindTemplateToolResult;
}): void {
  const terminal = result.structuredContent?.nextAction.kind === 'done';
  recordBindRecoveryAttemptFailOpen({
    session,
    askKey,
    outcome: 'bound',
    currentProposalSignature,
    reservationId,
    terminal,
  });
}

const title = 'Bind Template';

export const getBindTemplateTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const bindTemplateTool = new DesktopTool({
    server,
    name: 'bind-template',
    title,
    description:
      'Reads workbook + resolves fields itself; binds/applies. Plain chart: FIRST auto_apply:true, no discovery.',
    paramsSchema,
    annotations: {
      title,
      // NOT read-only and NOT idempotent: auto_apply:true mutates the live workbook via
      // loadWorkbookXml, and calcs[] author (mutate) even without auto-apply. The old
      // readOnly/idempotent hints told the host/model that retrying a bind is free — a
      // direct incentive for the blind-retry thrash (a completed apply re-run is a real
      // re-mutation, not a no-op). Honest hints let the host treat repeats as consequential.
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, ask, proposal, minConfidence, auto_apply, target_worksheet, calcs },
      extra,
    ): Promise<CallToolResult> => {
      return await bindTemplateTool.logAndExecute<BindTemplateToolResult>({
        extra,
        args: { session, ask, proposal, minConfidence, auto_apply, target_worksheet, calcs },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const askKey = normalizeAskForMatch(ask);
          const currentProposalSignature =
            proposal !== undefined ? proposalSignature(proposal as BindingProposal) : undefined;
          let bindRecoveryReservationId: number | undefined;

          try {
            const blocked = recoveryGateBlock(
              sessionRouteState.getBindRecovery(resolvedSession, askKey),
              currentProposalSignature,
            );
            if (blocked) {
              return new Ok(blocked);
            }
            bindRecoveryReservationId = sessionRouteState.reserveBindRecoveryAdmission(
              resolvedSession,
              askKey,
              {
                ...(currentProposalSignature !== undefined
                  ? { proposalSignature: currentProposalSignature }
                  : {}),
              },
            );
          } catch {
            /* fail-open */
          }

          const executor = await extra.getExecutor(resolvedSession);

          // Phase timing (only reported when auto_apply performs). The bind phase
          // subsumes the live workbook read since server-side they are one step.
          const bindStart = Date.now();

          // Events-clean anchor (W60 blind-spot #1 / adversary P1-4) — captured BEFORE
          // the read. The apply is whole-document last-writer-wins, so a user edit made
          // in Desktop between the read and the auto-apply would be silently reverted.
          // Anchoring AFTER the read (the original bug) left any edit landing in the
          // (read, anchor] window with sequence <= anchor, excluded by the strict `since`
          // filter → count 0 → silently overwritten. Anchoring before the read makes that
          // window checkable; worst case is now an over-cautious refusal (safe fallback),
          // never a silent overwrite.
          //
          // Caveat verified (offline, no live Desktop): getWorkbookXml is a document
          // serialization/read that emits no counted document event. Counted events are user `doc:*`
          // mutations (see checkForUserChanges tests), so a pre-read anchor does not
          // false-trip the gate. Best-effort: an executor without event support proceeds
          // rather than disabling auto_apply (Athena residual).
          let eventsAnchor: number | undefined;
          if (auto_apply === true) {
            const anchor = await executor.getEvents({ signal: extra.signal });
            if (anchor.isOk()) {
              eventsAnchor = anchor.value.latest_sequence;
            }
          }

          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }
          let workbookXml = xmlResult.value;
          let authoredCalcCaptions: string[] = [];
          if (calcs && calcs.length > 0) {
            const authored = await authorCalculationsInWorkbook({
              workbookXml,
              calcs: calcs as AuthorCalcInput[],
              executor,
              signal: extra.signal,
            });
            if (authored.isErr()) {
              return authored.error.toErr();
            }
            workbookXml = authored.value.workbookXml;
            authoredCalcCaptions = authored.value.authoredCalcs.map((calc) => calc.caption);
          }

          // SEAM: source manifests through bundledIntelligenceProvider (never raw
          // loadManifests) so a milestone-2 remote content-pack provider swaps in without
          // editing this tool — matching propose-template / validate-proposal, so all four
          // binder tools follow the same seam. The reconstructed Map is byte-identical to
          // loadManifests(): it keys by manifest.template (== filename, enforced there) and
          // listTemplateManifests() is exactly [...loadManifests().values()], so re-keying
          // by m.template reproduces it.
          const manifests = new Map(
            bundledIntelligenceProvider
              .listTemplateManifests()
              .map((m): [string, TemplateManifest] => [m.template, m]),
          );
          // Route-state recording is OBSERVATIONAL — a route-layer fault must never break a
          // bind (fail-open, the gate's own discipline): a swallowed classification simply
          // leaves the ask unrecorded and the gate later fail-opens on absent state.
          try {
            const routeDecision = classifyAskRoute(ask, [...manifests.values()]);
            sessionRouteState.recordAskClassification(resolvedSession, {
              ask: askKey,
              route: routeDecision.route,
              shape: routeDecision.shape,
              template: routeDecision.template,
            });
          } catch {
            // A classification fault on a NEW ask also invalidates whatever ask was
            // pending — leaving it would hand the gate a stale "no bind attempt yet"
            // record for a different ask (cross-ask leak).
            try {
              sessionRouteState.clearCurrentAsk(resolvedSession);
            } catch {
              /* fail-open */
            }
          }
          // ── Target-worksheet gate (e1/s7 stray-sheet class) ──────────
          // Validated BEFORE the bind and for BOTH modes (auto-apply and the manual
          // chain): an explicit target must be provably replaceable — a missing name
          // or a dashboard-member sheet would make removeSameNamedWorksheet defer and
          // Desktop dedup the inject into a stray "Name (1)" copy, the exact failure
          // this parameter exists to prevent.
          if (target_worksheet !== undefined) {
            const target = classifyWorksheetReplaceTarget(workbookXml, target_worksheet);
            if (target === 'not-found') {
              return new ArgsValidationError(
                `target_worksheet "${target_worksheet}" not found in the workbook — check list-worksheets, or omit target_worksheet to create a new sheet`,
              ).toErr();
            }
            if (target === 'in-dashboard') {
              return new ArgsValidationError(
                `target_worksheet "${target_worksheet}" is a dashboard member sheet — replacing it in place could corrupt the dashboard; omit target_worksheet to create a new sheet`,
              ).toErr();
            }
          }

          let res;
          try {
            res = await bindTemplate({
              ask,
              workbookXml,
              manifests,
              ...(proposal ? { proposal: proposal as BindingProposal } : {}),
              ...(minConfidence !== undefined ? { minConfidence } : {}),
            });
          } catch (e) {
            // A THROWN bind has no recordable outcome; clear the pending record (only if
            // it is still this ask's) so the gate can never read "no bind attempt yet"
            // for an ask whose bind WAS attempted. The error path itself is unchanged.
            try {
              sessionRouteState.clearCurrentAsk(resolvedSession, askKey);
            } catch {
              /* fail-open */
            }
            throw e;
          }
          if (target_worksheet !== undefined && res.status === 'bound') {
            res = { ...res, args: { ...res.args, title: target_worksheet } };
          }
          try {
            sessionRouteState.recordAskOutcome(resolvedSession, askKey, res.status);
            if (res.status === 'propose') {
              recordBindRecoveryAttemptFailOpen({
                session: resolvedSession,
                askKey,
                outcome: res.status,
                currentProposalSignature,
                reservationId: bindRecoveryReservationId,
              });
            } else if (res.status === 'escalate') {
              recordBindRecoveryAttemptFailOpen({
                session: resolvedSession,
                askKey,
                outcome: res.status,
                currentProposalSignature,
                reservationId: bindRecoveryReservationId,
                terminalFallback: TIER2_REASONS.has(res.reason),
              });
            }
          } catch {
            /* fail-open */
          }
          const bindMs = Date.now() - bindStart;
          const schemaSummary = summarizeSchema(workbookXml);

          const base: StructuredBindTemplateToolResult = annotateAuthoredCalcs(
            res.status === 'escalate'
              ? withNextAction(
                  { ...res, guidance: buildGuidance(res, schemaSummary, proposal) },
                  nextActionForEscalation(res.reason),
                )
              : { ...res, guidance: buildGuidance(res, schemaSummary, proposal) },
            authoredCalcCaptions,
          );

          // ── Auto-apply gate (defense in depth) ───────────────────────────
          // Auto-apply only for a bound result whose manifest remains fast-path eligible.
          // A Call-2 proposal bind is validated by the binder against the live workbook and
          // the apply runs under the SAME events-anchor user-change guard; on the slim
          // surface the manual apply tools do not exist, so the alternative is the model
          // freehand-building the same chart with FEWER guards. Applying a validated bind is
          // the safer branch. The defense-in-depth guard is now binder validation plus the
          // events anchor, not Call-1/Call-2 parity.
          const manifest =
            res.status === 'bound' ? manifests.get(res.args.template_name) : undefined;
          const canAutoApply =
            auto_apply === true && res.status === 'bound' && manifest?.fast_path_eligible === true;

          if (res.status !== 'bound') {
            return new Ok(base);
          }

          if (!canAutoApply || manifest === undefined) {
            recordBindRecoveryAttemptFailOpen({
              session: resolvedSession,
              askKey,
              outcome: res.status,
              currentProposalSignature,
              reservationId: bindRecoveryReservationId,
              terminal: true,
            });
            return new Ok(base);
          }

          const appliedResult = await performAutoApply({
            res,
            base,
            workbookXml,
            session: resolvedSession,
            executor,
            signal: extra.signal,
            bindMs,
            eventsAnchor,
            schemaSummary,
            manifest,
          });
          recordBoundRecoveryAfterFinalResult({
            session: resolvedSession,
            askKey,
            currentProposalSignature,
            reservationId: bindRecoveryReservationId,
            result: appliedResult,
          });
          return new Ok(appliedResult);
        },
        // Keep the standard MCP content-block envelope while lifting nextAction metadata
        // out of the JSON body so the bind/propose/bound body contract stays unchanged.
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return bindTemplateTool;
};
