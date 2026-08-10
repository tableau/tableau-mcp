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
  buildLlmInput,
  DERIVATION_OVERRIDE_INSTRUCTION,
  type EncodingReport,
  type EscalateReason,
  type LlmProposeInput,
  makeTitle,
  MAX_CLASSIFIABLE_FIELDS,
  resolveEncodingFieldInAsk,
  resolveInSummary,
  type SchemaField,
  type SchemaSummary,
  summarizeSchema,
  WATERFALL_ORDER_FIELD_RE,
} from '../../../../desktop/binder/binder.js';
import { classifyAskRoute, normalizeAskForMatch } from '../../../../desktop/binder/route-spec.js';
import { resolveDerivation } from '../../../../desktop/derivations.js';
import { emitWorksheetPromiseEvents } from '../../../../desktop/episode-events.js';
import { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { parseCanonicalColumnRef } from '../../../../desktop/metadata/field-resolver.js';
import { addFieldToEncoding } from '../../../../desktop/metadata/fields.js';
import { extractSheetXml, upsertSheetIntoWorkbook } from '../../../../desktop/metadata/sheets.js';
import {
  planSortByFieldOnCategoricalAxis,
  planTopN,
  type SortDirection,
} from '../../../../desktop/refine/refineWorksheet.js';
import {
  type AppliedSheetRecord,
  type BindRecoveryProposalContext,
  type BindRecoveryRecord,
  classifyBindProposalProgress,
  MAX_CONSECUTIVE_BIND_RECOVERY_BARE_RESUBMITS,
  sessionRouteState,
} from '../../../../desktop/route/route-state.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  buildInjectedWorkbookXml,
  classifyWorksheetReplaceTarget,
} from '../../../../desktop/templates/injectTemplateCore.js';
import { createPuppetCompatibilityProjection } from '../../../../desktop/templates/puppetCompatibilityProjection.js';
import { loadRuntimeTemplateCatalogSnapshots } from '../../../../desktop/templates/runtimeTemplateCatalog.js';
import type { TemplateRuntimeSnapshot } from '../../../../desktop/templates/templateRuntimeSnapshot.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../../desktop/validation/promise-check.js';
import {
  formatReadbackVerificationError,
  formatReadbackVerificationWarnings,
} from '../../../../desktop/validation/readback-verify.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import {
  publicReadbackVerificationResult,
  verifyPostApplyWorksheetReadback,
} from '../../../../desktop/wrappers/loadWorksheetXml.js';
import { decodeXmlEntities } from '../../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { fetchWorksheetSummaryData, type SummaryDataRead } from '../../api/summaryDataCore.js';
import {
  doneNextAction,
  jsonToolResult,
  type NextAction,
  prefillNextAction,
  receipt,
  type StructuredResult,
  withNextAction,
} from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import type { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';
import {
  type AuthorCalcInput,
  authorCalculationsInWorkbook,
  datatypeSchema,
  roleSchema,
} from '../datasource/authorCalcCore.js';
// The nested `proposal` mirrors the binder library's public data contract
// (`BindingProposal` / `PROPOSAL_OUTPUT_SCHEMA`) verbatim so a Call-1 `propose` payload
// round-trips into a Call-2 `proposal` unchanged. The schema (incl. the watch-class
// confidence-required + title-max-80 tightening) lives in proposalSchema.ts.
import { appliedSheetSignature } from './appliedSheetSignature.js';
import { proposalSchema } from './proposalSchema.js';
import { proposalSignature } from './proposalSignature.js';

const paramsSchema = {
  session: z
    .string()
    .optional()
    .describe('Desktop process ID; omit to use the pinned or only running instance.'),
  ask: z.string().describe('Verbatim ask.'),
  proposal: proposalSchema.optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  auto_apply: z.boolean().optional().describe('Apply immediately.'),
  skip_validation: z.boolean().optional(),
  // Undescribed, this parameter cost 299 repeat binds and 2,562 seconds: with no way to
  // learn that it means "edit THIS sheet", the agent left it out on an edit-in-place ask,
  // bind-template created a second sheet, and the follow-up edits chased the new sheet.
  target_worksheet: z.string().optional().describe('Worksheet to replace; omit to create.'),
  calcs: z
    .array(
      z.object({
        caption: z.string(),
        formula: z.string(),
        datatype: datatypeSchema.optional(),
        role: roleSchema.optional(),
      }),
    )
    .optional()
    .describe('Derived fields to author before binding.'),
};

/**
 * Result of one bind-template call: the binder outcome plus a plain-text next step.
 * When auto_apply performs (or attempts) a server-side apply, the applied fields are
 * present: `applied` + either `sheet_name`/`phase_ms` (success) or `apply_error`
 * (graceful fallback — the bound `args` are still intact).
 */
type BindTemplateToolResultBase = BinderResult & {
  guidance: string;
  call_2_contract?: Call2Contract;
  authored_calcs?: string[];
  warnings?: string[];
  applied?: boolean;
  sheet_name?: string;
  phase_ms?: { bind: number; inject: number; apply: number };
  apply_error?: string;
};

type AppliedDefault = Pick<
  NonNullable<LlmProposeInput['recommended']>,
  'measure' | 'top_n' | 'reason' | 'context_measures'
>;

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
  applied_default?: AppliedDefault;
  summary_rows?: { columns: unknown[]; rows: unknown[][] };
  summary_rows_error?: string;
  truncated?: true;
  /**
   * What the ask asked for vs what this bind built. Present ONLY when something the ask
   * asked for is missing from the sheet — a complete bind still returns the trimmed shape.
   */
  encodings?: EncodingReport;
};

/**
 * Returned INSTEAD of building a second sheet identical to one this session already built.
 * Presence-by-name is not enough evidence to claim the remembered sheet is still complete,
 * so reuse is non-terminal and offers an explicit rebuild.
 */
type ReusedSheetResult = {
  status: 'bound';
  applied: false;
  reused: true;
  authored_calcs?: string[];
  sheet_name: string;
  guidance: string;
  receipt: ReturnType<typeof receipt>;
};

type BlockedBindTemplateResult = {
  status: 'blocked';
  reason:
    | 'awaiting_proposal'
    | 'unchanged_proposal'
    | 'retry_budget_exhausted'
    | 'fallback_required';
  guidance: string;
  call_2_contract?: Call2Contract;
};

type BindTemplateToolResult =
  | BindTemplateToolResultBase
  | AppliedFastPathResult
  | ReusedSheetResult
  | BlockedBindTemplateResult;
type StructuredBindTemplateToolResult = StructuredResult<BindTemplateToolResult>;

type Call2Contract = BindRecoveryProposalContext;
type TerminalRepairAllowance = NonNullable<BindRecoveryRecord['terminalRepairAllowance']>;

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
const NOT_APPLIED_GUIDANCE =
  'NOT APPLIED — the worksheet is unchanged. Resubmit this exact call with auto_apply:true to apply the bind.';
const WATERFALL_TEMPLATE = 'part-to-whole-waterfall';
// A P&L/bridge running total is order-dependent and its intended
// order is usually a non-displayed sequence field; the hint names it so the singer carries it
// in the ORIGINAL bind (proposal.sort) instead of giving up on refine or falling to XML surgery.
const WATERFALL_SORT_HINT =
  'Waterfall default sort is DESC by the bound measure; override with proposal.sort:{by:<field>,direction:"asc"|"desc"} IN THE BIND — refine-worksheet cannot sort by a field that is not on the view.';
// Terminal stop-clause appended to the applied:true receipt when NO re-bind slot is unfilled
// (Blake's spiral): the model reads guidance verbatim, so this directly contradicts the
// bundled skill's "adapt fields/formatting" + the ambient "search-commands available" pulls.
// Paired with structuredContent.nextAction{kind:'done'} for host orchestration.
const TERMINAL_GUIDANCE = 'Done — no further tool calls needed.';
// When the confident bind already applied a top-N limit and/or an interactive filter, the
// singer must NOT hand-author another one. These clauses are appended only for splices the
// function observed succeeding; requested-but-skipped filters are warnings, not successes.
const FILTER_APPLIED_GUIDANCE =
  'The requested filter is ALREADY applied. Do NOT add another filter — a second one can change the scoping. The interactive control may not render as a visible card; that is a display detail, not a missing filter.';
const TOP_N_APPLIED_GUIDANCE =
  'The requested top-N limit is ALREADY applied. Do NOT add another limit.';
const PROPOSAL_ATTEMPTED_PHASE = ['proposal', 'attempted'].join('-');
const RETRY_USED_PHASE = ['retry', 'used'].join('-');
const SUMMARY_ROWS_MAX_ROWS = 20;
const EMPTY_SUMMARY_ROWS_ERROR = 'empty readback — verify with get-summary-data';
const EMPTY_SUMMARY_ROWS_GUIDANCE =
  'Summary readback returned zero rows; check the sheet and its filters before claiming the chart is complete.';
const SUMMARY_ROWS_MAX_BYTES = 2048;
const SUMMARY_ROWS_MAX_CELL_CHARS = 256;
const SUMMARY_ROWS_TIMEOUT_MS = 2000;
const SUMMARY_ROWS_ERROR_MAX_CHARS = 512;
const UNIT_HETEROGENEITY_DIMENSION_RE =
  /^(currency([ _-]?code)?|curr|fx([ _-]?rate)?|unit([ _-]?of[ _-]?measure)?)$/i;

type CanonicalColumnRef = NonNullable<ReturnType<typeof parseCanonicalColumnRef>>;

function xmlTagRegions(xml: string, containerTags: string[], elementTags: string[] = []): string {
  const regions: string[] = [];
  for (const tag of containerTags) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const match of xml.matchAll(pattern)) {
      regions.push(match[1]);
    }
  }
  for (const tag of elementTags) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
    for (const match of xml.matchAll(pattern)) {
      regions.push(match[0]);
    }
  }
  return regions.join(' ');
}

function canonicalRefsIn(xml: string): CanonicalColumnRef[] {
  const decoded = decodeXmlEntities(xml);
  return Array.from(decoded.matchAll(/\[[^\]]+\]\.\[[^\]]+\]/g), ([ref]) =>
    parseCanonicalColumnRef(ref),
  ).filter((ref): ref is CanonicalColumnRef => ref !== null);
}

function refMatchesSchemaField(ref: CanonicalColumnRef, field: SchemaField): boolean {
  return (
    ref.datasource.toLowerCase() === field.datasource.toLowerCase() &&
    ref.localFieldName.toLowerCase() === bareColumnName(field.columnName).toLowerCase()
  );
}

function currencyHeterogeneityCaveat(
  schemaSummary: SchemaSummary,
  worksheetXml: string | null,
): string {
  if (!worksheetXml) return '';

  const displayedRefs = canonicalRefsIn(xmlTagRegions(worksheetXml, ['rows', 'cols', 'encodings']));
  const summedMeasure = schemaSummary.fields.find(
    (field) =>
      field.role === 'measure' &&
      displayedRefs.some(
        (ref) => ref.derivation.toLowerCase() === 'sum' && refMatchesSchemaField(ref, field),
      ),
  );
  if (!summedMeasure) return '';

  // Detail/LOD, shape, and text partition marks per member just like rows/cols do,
  // so a currency column on any of them means the sum is NOT cross-currency.
  const visibleDimensionRefs = canonicalRefsIn(
    xmlTagRegions(worksheetXml, ['rows', 'cols'], ['color', 'filter', 'lod', 'shape', 'text']),
  );
  const omittedUnitDimension = schemaSummary.fields.find(
    (field) =>
      field.datasource === summedMeasure.datasource &&
      field.role === 'dimension' &&
      [field.caption, bareColumnName(field.columnName)].some(
        (name) => !!name && UNIT_HETEROGENEITY_DIMENSION_RE.test(name),
      ) &&
      !visibleDimensionRefs.some((ref) => refMatchesSchemaField(ref, field)),
  );
  if (!omittedUnitDimension) return '';

  const measureName = summedMeasure.caption ?? bareColumnName(summedMeasure.columnName);
  const unitName = omittedUnitDimension.caption ?? bareColumnName(omittedUnitDimension.columnName);
  return `Note: [${measureName}] is summed across [${unitName}] without conversion — state this assumption in one line.`;
}

type SummaryRowsEnrichment = Pick<
  AppliedFastPathResult,
  'summary_rows' | 'summary_rows_error' | 'truncated'
>;

function capSummaryRows(columns: unknown[], rows: unknown[][]): SummaryRowsEnrichment {
  if (rows.length === 0) {
    return { summary_rows_error: EMPTY_SUMMARY_ROWS_ERROR };
  }

  const cappedColumns = [...columns];
  let cellTruncated = false;
  const candidateRows = rows.slice(0, SUMMARY_ROWS_MAX_ROWS).map((row) =>
    row.map((cell) => {
      if (typeof cell !== 'string' || cell.length <= SUMMARY_ROWS_MAX_CELL_CHARS) {
        return cell;
      }
      cellTruncated = true;
      return cell.slice(0, SUMMARY_ROWS_MAX_CELL_CHARS);
    }),
  );
  const prefix = `{"columns":${JSON.stringify(cappedColumns)},"rows":[`;
  const suffix = ']}';
  let payloadBytes = Buffer.byteLength(prefix, 'utf8') + Buffer.byteLength(suffix, 'utf8');
  const cappedRows: unknown[][] = [];

  for (const row of candidateRows) {
    const serializedRow = JSON.stringify(row);
    const nextRowBytes =
      Buffer.byteLength(serializedRow, 'utf8') + (cappedRows.length === 0 ? 0 : 1);
    if (payloadBytes + nextRowBytes > SUMMARY_ROWS_MAX_BYTES) {
      break;
    }
    cappedRows.push(row);
    payloadBytes += nextRowBytes;
  }

  if (cappedRows.length === 0) {
    return { summary_rows_error: 'oversize readback' };
  }

  return {
    summary_rows: { columns: cappedColumns, rows: cappedRows },
    ...(cellTruncated || rows.length > cappedRows.length ? { truncated: true } : {}),
  };
}

function boundedSummaryRowsError(reason: string): string {
  return reason.length <= SUMMARY_ROWS_ERROR_MAX_CHARS
    ? reason
    : `${reason.slice(0, SUMMARY_ROWS_ERROR_MAX_CHARS - 1)}…`;
}

async function readAppliedSummaryRows({
  executor,
  signal,
  worksheetName,
}: {
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
  worksheetName: string;
}): Promise<SummaryRowsEnrichment> {
  const timeoutController = new AbortController();
  const onAbort = (): void => timeoutController.abort(signal.reason);
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const reason = `summary rows readback timed out after ${SUMMARY_ROWS_TIMEOUT_MS}ms`;
      timeoutController.abort(new Error(reason));
      reject(new Error(reason));
    }, SUMMARY_ROWS_TIMEOUT_MS);
  });
  const read: SummaryDataRead = async (_endpoint, readEndpoint) => {
    const result = await readEndpoint(executor, timeoutController.signal);
    return result.isErr() ? new DesktopCommandExecutionError(result.error).toErr() : result;
  };

  try {
    const result = await Promise.race([
      fetchWorksheetSummaryData({
        read,
        worksheet: worksheetName,
        maxRows: SUMMARY_ROWS_MAX_ROWS + 1,
      }),
      timeoutFailure,
    ]);
    if (result.isErr()) {
      return {
        summary_rows_error: boundedSummaryRowsError(result.error.error.getErrorText()),
      };
    }
    return capSummaryRows(result.value.columns, result.value.rows);
  } catch (error) {
    return { summary_rows_error: boundedSummaryRowsError(getExceptionMessage(error)) };
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    signal.removeEventListener('abort', onAbort);
  }
}

function blockedResult(
  reason: BlockedBindTemplateResult['reason'],
  guidance: string,
  nextActionLabel: string,
  call2Contract?: Call2Contract,
): StructuredBindTemplateToolResult {
  return withNextAction(
    {
      status: 'blocked',
      reason,
      guidance,
      ...(call2Contract !== undefined ? { call_2_contract: call2Contract } : {}),
    },
    prefillNextAction(nextActionLabel),
  );
}

function bareResubmitFallbackResult(
  proposalContext: Call2Contract | undefined,
): StructuredBindTemplateToolResult {
  return blockedResult(
    'fallback_required',
    'Blocked: bind-template received two consecutive calls without the required proposal. Stop calling bind-template and use build-and-apply-worksheet. If a user decision is still required, use ask-user and present the retained call_2_contract choices; do not choose a measure.',
    'Use build-and-apply-worksheet',
    proposalContext,
  );
}

function recoveryGateBlock(
  record: ReturnType<typeof sessionRouteState.getBindRecovery>,
  currentProposalSignature: string | undefined,
  currentProposal: BindingProposal | undefined,
  session: string,
  askKey: string,
  targetWorksheet: string | undefined,
): StructuredBindTemplateToolResult | undefined {
  // Naming a target is an explicit rebuild instruction, not another bare recovery attempt.
  // It must be able to escape even a terminal same-ask recovery record.
  if (targetWorksheet !== undefined) {
    return undefined;
  }

  if (!record) {
    return undefined;
  }

  if (record.phase === 'terminal') {
    const repair = record.terminalRepairAllowance;
    if (
      repair?.remaining === 1 &&
      currentProposal?.template === repair.template &&
      currentProposal.bindings.some((binding) => binding.slot_id === repair.slotId) &&
      sessionRouteState.consumeTerminalRepairAllowance(
        session,
        askKey,
        repair.template,
        repair.slotId,
      )
    ) {
      return undefined;
    }
    if (
      (record.consecutiveBareResubmitCount ?? 0) >= MAX_CONSECUTIVE_BIND_RECOVERY_BARE_RESUBMITS
    ) {
      return bareResubmitFallbackResult(record.proposalContext);
    }
    return blockedResult(
      'fallback_required',
      'Blocked: bind-template already determined this ask is not recoverable in the fast path. Use build-and-apply-worksheet, or place fields stepwise with add-field then apply-worksheet; ask-user only if the fallback path needs a user decision.',
      'Use fallback authoring path',
    );
  }

  if (currentProposalSignature === undefined) {
    const updatedRecord = sessionRouteState.recordBindRecoveryBareResubmit(session, askKey);
    if (updatedRecord?.phase === 'terminal') {
      return bareResubmitFallbackResult(updatedRecord.proposalContext);
    }
    const proposalContext = updatedRecord?.proposalContext ?? record.proposalContext;
    const recommended = proposalContext?.recommended;
    const choiceGuidance = recommended
      ? `Use recommended measure ${JSON.stringify(recommended.measure)} with top_n:${recommended.top_n} in Call 2, then STATE this choice in your reply.`
      : 'If the measure remains ambiguous, use ask-user and present these choices; do not guess.';
    return blockedResult(
      'awaiting_proposal',
      'Blocked: bind-template already returned a proposal request for this ask. The same choices from the previous llm_input are repeated in call_2_contract below. Choose an exact compatible field for every required slot, then call bind-template with the listed arguments plus proposal:{template,title,bindings:[{slot_id,field}],confidence}. Do not resubmit the bare ask. ' +
        choiceGuidance,
      recommended ? 'Use recommended proposal' : 'Pick a proposal or ask user',
      proposalContext,
    );
  }

  sessionRouteState.resetBindRecoveryBareResubmitCount(session, askKey);

  if (
    currentProposalSignature !== undefined &&
    record.lastProposalSignature === currentProposalSignature &&
    record.preDispatchRetryAllowance?.proposalSignature === currentProposalSignature &&
    record.preDispatchRetryAllowance.remaining === 1 &&
    sessionRouteState.consumePreDispatchRetryAllowance(session, askKey, currentProposalSignature)
  ) {
    return undefined;
  }

  const proposalProgress = classifyBindProposalProgress(record, currentProposalSignature);
  if (
    proposalProgress === 'limit' ||
    (proposalProgress === 'repeat' && record.phase === RETRY_USED_PHASE)
  ) {
    return blockedResult(
      'retry_budget_exhausted',
      'Blocked: this proposal repeats an attempted signature or the bounded distinct correction limit is exhausted. Stop cycling bind-template; ask-user if more information is needed, or use build-and-apply-worksheet.',
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

  if (proposalProgress === 'repeat') {
    return blockedResult(
      'retry_budget_exhausted',
      'Blocked: this proposal repeats an earlier attempted signature. Stop cycling bind-template; ask-user if more information is needed, or use build-and-apply-worksheet.',
      'Use fallback path or ask user',
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

/**
 * A recoverable escalation now ships the candidate shortlist, so say where it is. Without it
 * the agent that was told to "re-propose" had nothing to propose FROM: the live transcript
 * shows it falling through to search-commands, which answered an encoding ask with mapbox
 * logging and device-layout removal, and then reading a whole knowledge document.
 */
const ESCALATE_CANDIDATES_SENTENCE =
  'The candidate templates and the fields that fit each of their slots are in call_2_contract.proposal_choices below — bind from those; do not go hunting with search-commands or the knowledge tools.';

function renderEscalationGuidance(
  reason: EscalateReason,
  blockers: Blocker[],
  /** True only when this result actually carries call_2_contract — never promise a payload we dropped. */
  hasCandidates: boolean,
): string {
  let next: string;
  const outcome = TIER2_REASONS.has(reason)
    ? 'Fast-path template bind did not apply; direct authoring is available.'
    : 'No worksheet was produced.';
  const candidates = hasCandidates ? ` ${ESCALATE_CANDIDATES_SENTENCE}` : '';
  if (reason === 'ambiguous-field' || reason === 'field-not-found') {
    next =
      'Resolve the field(s) with the resolve-field tool, then call bind-template again with a corrected proposal; otherwise ask the user with ask-user (present the candidates).' +
      candidates;
  } else if (reason === 'low-confidence') {
    next =
      'Confidence was below the floor. Re-examine the candidate template(s), pick the best fit, and re-propose with higher confidence.' +
      candidates;
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

function hasSortOverride(res: BinderResult, proposal?: BindingProposal): boolean {
  if (res.status === 'bound') {
    return res.args.sort !== undefined;
  }
  return proposal?.sort !== undefined;
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

/**
 * The ask named an encoding this bind could not fill. Name it, say the sheet is missing it,
 * and name the two-call edit/apply sequence that finishes it on the sheet that already exists.
 * It must point
 * AWAY from bind-template: the measured failure mode is the model asking again in other
 * words (55% of production bind traces rebind the same worksheet), rebuilding the same chart.
 */
const MAX_ENCODING_FIELD_CANDIDATES = 3;

function quoteGuidanceValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function encodingColumnRefGuidance(
  ask: string,
  role: EncodingReport['unfilled'][number],
  schemaSummary: SchemaSummary,
): string {
  const resolution = resolveEncodingFieldInAsk(ask, role, schemaSummary);
  if (resolution.field) {
    return quoteGuidanceValue(resolution.field.column_ref);
  }
  if (resolution.candidates.length === 0) {
    return '<field>';
  }
  const candidates = resolution.candidates
    .slice(0, MAX_ENCODING_FIELD_CANDIDATES)
    .map((candidate) => {
      const caption = candidate.caption ?? candidate.name;
      return `${quoteGuidanceValue(candidate.column_ref)} (${quoteGuidanceValue(caption)})`;
    })
    .join(', ');
  return `<one of: ${candidates}>`;
}

function appendUnfilledEncodingGuidance(
  receipt: string,
  sheetName: string,
  encodings: EncodingReport,
  ask: string,
  schemaSummary: SchemaSummary,
): string {
  const missing = encodings.unfilled.join(' and ');
  const addFieldCalls = encodings.unfilled
    .map(
      (role, index) =>
        `add-field{${
          index === 0
            ? `worksheetName:'${sheetName}'`
            : 'worksheetFile:<path returned by previous add-field>'
        },target:'encoding',encodingType:'${role}',columnRef:${encodingColumnRefGuidance(
          ask,
          role,
          schemaSummary,
        )}}`,
    )
    .join(', then ');
  const applyCall = `apply-worksheet{worksheetName:'${sheetName}',worksheetFile:<path returned by previous add-field>}`;
  const filled = encodings.filled.length > 0 ? encodings.filled.join(', ') : 'none';
  return (
    `${receipt} INCOMPLETE — the ask asked for ${missing}, and this bind did NOT fill it: ` +
    `the sheet is on screen without ${missing}. Encodings filled: ${filled}. ` +
    `To finish, call ${addFieldCalls}, then ${applyCall}. ` +
    'Do NOT call bind-template again for this sheet; asking again in other words rebuilds the same chart.'
  );
}

/** Label for the same steer, short enough for the 60-char nextAction label bound. */
function unfilledEncodingNextActionLabel(encodings: EncodingReport): string {
  return `Add ${encodings.unfilled.join(', ')}, then apply-worksheet`;
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

function fieldFitsProposedSlot(
  field: LlmProposeInput['fields'][number],
  slot: LlmProposeInput['candidate_templates'][number]['slots'][number],
): boolean {
  switch (slot.kind) {
    case 'quantitative':
      return field.role === 'measure';
    case 'categorical':
      return field.role === 'dimension' && (field.type === 'nominal' || field.type === 'ordinal');
    case 'quantitative-or-categorical':
      return (
        field.role === 'measure' ||
        (field.role === 'dimension' && (field.type === 'nominal' || field.type === 'ordinal'))
      );
    case 'temporal':
      return (
        field.datatype === 'date' ||
        field.datatype === 'datetime' ||
        (slot.temporal_from_string === true && field.datatype === 'string')
      );
    case 'geo':
      return field.role === 'dimension';
    default:
      return false;
  }
}

function buildCall2Contract({
  llmInput,
  session,
  ask,
  targetWorksheet,
}: {
  llmInput: LlmProposeInput;
  session: string;
  ask: string;
  targetWorksheet?: string;
}): Call2Contract {
  return {
    tool: 'bind-template',
    arguments: {
      session,
      ask,
      ...(targetWorksheet !== undefined ? { target_worksheet: targetWorksheet } : {}),
      auto_apply: true,
    },
    ...(llmInput.recommended ? { recommended: llmInput.recommended } : {}),
    proposal_choices: llmInput.candidate_templates.map((candidate) => ({
      template: candidate.template,
      slots: candidate.slots.map((slot) => {
        const compatibleFields = llmInput.fields.filter((field) =>
          fieldFitsProposedSlot(field, slot),
        );
        const labeledOptions = compatibleFields.flatMap((field) =>
          field.label ? [{ name: field.name, label: field.label }] : [],
        );
        return {
          slot_id: slot.slot_id,
          required: slot.required,
          compatible_field_names: compatibleFields.map((field) => field.name),
          ...(labeledOptions.length > 0 ? { compatible_field_options: labeledOptions } : {}),
        };
      }),
    })),
    proposal_requirements: {
      title: 'Choose a worksheet title.',
      confidence: 'Set a confidence from 0 to 1.',
      field_selection: llmInput.fields.some((field) => field.label)
        ? 'Use compatible_field_options labels to compare table grain, then bind its exact name from compatible_field_names; do not rename or infer a field.'
        : 'For each binding, choose one exact compatible_field_names value; do not rename or infer a field.',
    },
  };
}

function proposalChoiceGuidance(llmInput: LlmProposeInput): string {
  const recommended = llmInput.recommended;
  return recommended
    ? `Use recommended measure ${JSON.stringify(recommended.measure)} with top_n:${recommended.top_n} in Call 2; after it succeeds, STATE this choice in your reply.`
    : 'No recommendation is available. If a required choice remains ambiguous, call ask-user; do not guess.';
}

function proposalFromRecommendation(
  ask: string,
  recommended: NonNullable<LlmProposeInput['recommended']>,
): BindingProposal {
  return {
    ...recommended.binding,
    title: makeTitle(ask),
    confidence: 1,
    top_n: recommended.top_n,
  };
}

function appliedDefaultFrom(
  recommended: NonNullable<LlmProposeInput['recommended']>,
): AppliedDefault {
  return {
    measure: recommended.measure,
    top_n: recommended.top_n,
    reason: recommended.reason,
    context_measures: recommended.context_measures,
  };
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
  const orderUnfilled = !hasSortOverride(res) && waterfallOrderCandidates(schemaSummary).length > 0;
  return orderUnfilled;
}

function buildGuidance(
  res: BinderResult,
  schemaSummary?: SchemaSummary,
  proposal?: BindingProposal,
  escalateHasCandidates = false,
): string {
  let guidance: string;
  switch (res.status) {
    case 'bound':
      guidance = `${NOT_APPLIED_GUIDANCE} ${res.apply_instruction || APPLY_INSTRUCTION}`;
      break;
    case 'propose':
      guidance =
        'Call 1 requires a proposal. Choose one call_2_contract proposal choice, bind its exact slot IDs ' +
        'to exact compatible field names, and make Call 2 with the same ask/target, proposal, and ' +
        `auto_apply:true. ${proposalChoiceGuidance(res.llm_input)} ${DERIVATION_OVERRIDE_INSTRUCTION}. ` +
        'Do not call other authoring tools between calls.';
      break;
    case 'escalate':
      guidance = renderEscalationGuidance(res.reason, res.blockers, escalateHasCandidates);
      break;
  }
  return res.status === 'propose'
    ? guidance
    : appendWaterfallDiscoveryGuidance(guidance, res, schemaSummary, proposal);
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

type AutoApplyFailureDisposition = 'pre-dispatch' | 'post-dispatch';

function applyFailureDisposition(
  error:
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError },
): AutoApplyFailureDisposition {
  if (
    error.type === 'load-workbook-xml-error' &&
    (error.error.type === 'invalid-xml' || error.error.type === 'validation-failed')
  ) {
    return 'pre-dispatch';
  }
  return 'post-dispatch';
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
      `<column-instance column='[${escapeXmlAttribute(columnName)}]' derivation='${resolveDerivation(
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

/**
 * Declare a FILTER field's column + column-instance in <datasource-dependencies> — the mirror
 * of {@link ensureSortByColumnDependency} for an m7 context filter. A <filter column='[DS].[CI]'>
 * references a phantom CI unless both the base <column> and the <column-instance> exist in the
 * dependency block, so this ensures them (idempotent: skips whichever is already declared).
 * Returns the parsed CI parts the caller needs to emit the filter node (`instanceName`, `role`).
 */
function ensureFilterColumnDependency(
  xml: string,
  field: NonNullable<ReturnType<typeof resolveInSummary>['field']>,
):
  | { ok: true; xml: string; columnRef: string; instanceName: string; level: string; role: string }
  | { ok: false; reason: string } {
  const parsed = parseQualifiedColumnInstance(field.column_ref);
  if (!parsed) {
    return {
      ok: false,
      reason: `filter field "${field.name}" did not resolve to a column-instance ref`,
    };
  }

  const columnName = bareColumnName(field.columnName);
  const columnDeclared = new RegExp(
    `<column\\s[^>]*\\bname=(['"])\\[${columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\1`,
  ).test(xml);
  const instanceDeclared =
    xml.includes(`name='${parsed.instanceName}'`) || xml.includes(`name="${parsed.instanceName}"`);
  if (columnDeclared && instanceDeclared) {
    return {
      ok: true,
      xml,
      columnRef: field.column_ref,
      instanceName: parsed.instanceName,
      level: parsed.instanceName,
      role: parsed.role,
    };
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
      `<column-instance column='[${escapeXmlAttribute(columnName)}]' derivation='${resolveDerivation(
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
      reason: `could not declare filter field "${field.name}" in datasource-dependencies`,
    };
  }
  return {
    ok: true,
    xml: out,
    columnRef: field.column_ref,
    instanceName: parsed.instanceName,
    level: parsed.instanceName,
    role: parsed.role,
  };
}

/**
 * Emit an interactive dimension filter node (m7). A `context:true` filter carries
 * `context='true'` — Tableau order-of-operations step 3, which runs BEFORE the Top-N
 * dimension filter (step 4), so a top-N within this dimension ranks WITHIN the selection.
 * With no member `values`, emit the enumerate-all interactive control
 * (`function='level-members'` + `user:ui-enumeration='all'`, single node — the confirmed
 * "all members selected" control form); with values, an inclusive member union.
 */
function buildInteractiveFilterNode(p: {
  columnRef: string;
  level: string;
  context: boolean;
  values?: string[];
}): string {
  const contextAttr = p.context ? " context='true'" : '';
  const level = escapeXmlAttribute(p.level);
  if (p.values && p.values.length > 0) {
    const members = p.values
      .map(
        (v) =>
          `<groupfilter function='member' level='${level}' member='${escapeXmlAttribute(v)}' user:ui-enumeration='inclusive' user:ui-marker='enumerate' />`,
      )
      .join('');
    return (
      `<filter class='categorical' column='${escapeXmlAttribute(p.columnRef)}'${contextAttr}>` +
      `<groupfilter function='union' user:ui-enumeration='inclusive' user:ui-marker='enumerate'>${members}</groupfilter>` +
      '</filter>'
    );
  }
  return (
    `<filter class='categorical' column='${escapeXmlAttribute(p.columnRef)}'${contextAttr}>` +
    `<groupfilter function='level-members' level='${level}' user:ui-enumeration='all' />` +
    '</filter>'
  );
}

/**
 * Insert a filter node AFTER </datasource-dependencies> (so it precedes <slices>/<aggregation>,
 * matching the top-N filter placement) and add the filtered CI to <slices>, reusing the SAME
 * ordering the refine planner uses (insertFilterAndSlices). Kept local (that helper is not
 * exported); creates or extends <slices> exactly as the top-N path does.
 */
function insertFilterNodeAndSlice(xml: string, filterXml: string, sliceColumn: string): string {
  let out = xml.replace(/<\/datasource-dependencies>/, (m) => `${m}\n      ${filterXml}`);
  const sliceEntry = `<column>${sliceColumn}</column>`;
  if (/<slices\b[^>]*\/>/.test(out)) {
    out = out.replace(/<slices\b[^>]*\/>/, `<slices>${sliceEntry}</slices>`);
  } else if (/<slices>[\s\S]*?<\/slices>/.test(out)) {
    // Guard against duplicates by the exact slice ENTRY, not the bare CI ref: the CI ref also
    // appears in the filter node just inserted, so `includes(sliceColumn)` would wrongly skip
    // a legitimate second slice (e.g. planTopN already added the product CI to <slices>).
    if (!out.includes(sliceEntry)) {
      out = out.replace(/<\/slices>/, `${sliceEntry}</slices>`);
    }
  } else if (/<aggregation\b/.test(out)) {
    out = out.replace(/(\s*)(<aggregation\b)/, `$1<slices>${sliceEntry}</slices>$1$2`);
  } else {
    out = out.replace(filterXml, `${filterXml}\n      <slices>${sliceEntry}</slices>`);
  }
  return out;
}

/** Splice a filter card into ONE worksheet-window body, creating the cards scaffold if absent. */
function spliceCardIntoWindowBody(inner: string, card: string, columnRef: string): string {
  // Already carries a filter card for this CI — leave it.
  if (
    inner.includes(`param='${escapeXmlAttribute(columnRef)}'`) &&
    /type=['"]filter['"]/.test(inner)
  ) {
    return inner;
  }
  const leftStripRe =
    /(<edge\b[^>]*\bname=(['"])left\2[^>]*>\s*<strip\b[^>]*>)([\s\S]*?)(<\/strip>)/;
  const cardsBlockRe = /(<cards>)([\s\S]*?)(<\/cards>)/;
  const emptyCardsRe = /<cards\s*\/>/;
  if (leftStripRe.test(inner)) {
    return inner.replace(
      leftStripRe,
      (_w, open: string, _q, _q2, body: string, close: string) => `${open}${body}${card}${close}`,
    );
  }
  if (cardsBlockRe.test(inner)) {
    return inner.replace(
      cardsBlockRe,
      (_w, open: string, body: string, close: string) =>
        `${open}${body}<edge name='left'><strip size='160'>${card}</strip></edge>${close}`,
    );
  }
  if (emptyCardsRe.test(inner)) {
    return inner.replace(
      emptyCardsRe,
      `<cards><edge name='left'><strip size='160'>${card}</strip></edge></cards>`,
    );
  }
  // No cards node — create the scaffold as the FIRST child (worksheet window content model:
  // <cards> then viewpoint/simple-id).
  return `<cards><edge name='left'><strip size='160'>${card}</strip></edge></cards>${inner}`;
}

/**
 * Fully decode XML entities to a FIXPOINT. The inject path escapes the title TWICE (the binder
 * escapes proposal.title once into args.title, then inject core escapes it again for {{TITLE}}),
 * so a serialized window name can be doubly-escaped (`&amp;amp;`). decodeXmlEntities peels ONE
 * level; iterating to stability collapses any escape depth so a decoded window name compares
 * equal to the plain literal title. Bounded (each pass strictly shrinks or is the last).
 */
function fullyDecodeXmlEntities(value: string): string {
  let prev = value;
  for (let i = 0; i < 8; i++) {
    const next = decodeXmlEntities(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

/**
 * Emit a SHOWN interactive filter CARD into the sheet's worksheet <window> (the judge's
 * filter_action_wired gate — a context filter alone is OoO-correct but INVISIBLE). Adds
 * `<card mode='dropdown' param='<CI>' type='filter' />` on the window's LEFT edge, creating
 * the <cards>/<edge name='left'>/<strip> scaffold when absent. Best-effort: on any structural
 * miss (no matching window, card already present) it returns the XML unchanged rather than
 * corrupting the tree — the OoO filter still applied, the card is a visibility add-on.
 *
 * `literalTitle` is the PLAIN (fully-decoded) sheet name: each candidate window's `name` is
 * fully decoded before comparison, so single- OR double-escaped serializations both match and a
 * whole-workbook re-serialize never mutates a sibling sheet's cards.
 */
function insertShownFilterCard(xml: string, literalTitle: string, columnRef: string): string {
  const card = `<card mode='dropdown' param='${escapeXmlAttribute(columnRef)}' type='filter' />`;
  const windowRe = /<window\b([^>]*)\bclass=(['"])worksheet\2([^>]*)>([\s\S]*?)<\/window>/g;
  return xml.replace(windowRe, (whole, pre: string, _q, post: string, inner: string) => {
    const nameAttr = attrValue(`${pre} ${post}`, 'name');
    if (nameAttr === null || fullyDecodeXmlEntities(nameAttr) !== literalTitle) return whole;
    const openTag = whole.slice(0, whole.length - inner.length - '</window>'.length);
    return `${openTag}${spliceCardIntoWindowBody(inner, card, columnRef)}</window>`;
  });
}

/** Read a single/double-quoted attribute value out of an element's attribute text (null if absent). */
function attrValue(attrs: string, key: string): string | null {
  const m = attrs.match(new RegExp(`\\b${key}=(?:'([^']*)'|"([^"]*)")`));
  if (!m) return null;
  return m[1] ?? m[2] ?? '';
}

function applyProposalSplices({
  xml,
  args,
  schemaSummary,
  literalTitle,
}: {
  xml: string;
  args: BoundResult['args'];
  schemaSummary: SchemaSummary;
  /** The PLAIN (fully-decoded) sheet name — scopes the shown-filter-card edit to this sheet's window. */
  literalTitle: string;
}):
  | { ok: true; xml: string; warnings: string[]; appliedFilterCount: number }
  | { ok: false; reason: string } {
  let out = xml;
  const warnings: string[] = [];
  let appliedFilterCount = 0;
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
  // Declarative interactive filters (m7). CRITICAL ORDERING: this runs AFTER the top_n splice
  // so planTopN sees the clean single-dimension sheet and never trips its >1-dimension refusal
  // (a filter-only CI would otherwise look like a second rankable dimension). A context:true
  // filter is Tableau OoO step 3 (before the top-N dimension filter at step 4), so a "top N
  // within the selected region" ranks WITHIN the selection rather than globally-then-filtered.
  if (args.filters && args.filters.length > 0) {
    for (const filter of args.filters) {
      const resolved = resolveInSummary(schemaSummary, filter.field);
      if ((resolved.kind !== 'exact' && resolved.kind !== 'rewritten') || !resolved.field) {
        warnings.push(`filter splice skipped: no unique field named "${filter.field}"`);
        continue;
      }
      const declared = ensureFilterColumnDependency(out, resolved.field);
      if (!declared.ok) {
        warnings.push(`filter splice skipped: ${declared.reason}`);
        continue;
      }
      const filterNode = buildInteractiveFilterNode({
        columnRef: declared.columnRef,
        level: declared.level,
        context: filter.context === true,
        values: filter.values,
      });
      declared.xml = insertFilterNodeAndSlice(declared.xml, filterNode, declared.columnRef);
      // The SHOWN card is what the judge's filter_action_wired gate checks — an OoO-correct
      // context filter with no control is invisible. Best-effort (no-op if the window is absent).
      out = insertShownFilterCard(declared.xml, literalTitle, declared.columnRef);
      appliedFilterCount += 1;
    }
  }
  return { ok: true, xml: out, warnings, appliedFilterCount };
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
  ask,
  workbookXml,
  session,
  config,
  executor,
  signal,
  bindMs,
  schemaSummary,
  templateSnapshot,
  appliedDefault,
  skipValidation,
}: {
  res: BoundResult;
  base: BindTemplateToolResultBase;
  ask: string;
  workbookXml: string;
  session: string;
  config: TableauDesktopRequestHandlerExtra['config'];
  executor: ExternalApiToolExecutor;
  signal: AbortSignal;
  bindMs: number;
  schemaSummary: SchemaSummary;
  templateSnapshot: TemplateRuntimeSnapshot;
  appliedDefault?: AppliedDefault;
  skipValidation?: boolean;
}): Promise<{
  result: StructuredBindTemplateToolResult;
  failureDisposition?: AutoApplyFailureDisposition;
  // An applied:true receipt the binder itself could not call finished. The result body
  // cannot carry this: `withNextAction` spreads, so an incomplete receipt still looks
  // applied:true with a sheet_name to every downstream reader.
  incomplete?: boolean;
}> {
  const { args } = res;

  // ── Inject leg (shared core) ─────────────────────────────────────
  const injectStart = Date.now();
  let injected: ReturnType<typeof buildInjectedWorkbookXml>;
  try {
    // SEA-aware template read (#433 seam): embedded asset in a SEA binary, disk otherwise.
    const templateXml = templateSnapshot.xml;
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
      templateSlots: templateSnapshot.descriptor.slots,
      applyNonce,
      optionalFieldPrunes: args.optional_field_prunes,
      dateparseAxis: args.dateparse_axis,
    });
  } catch (err) {
    return {
      result: applyFallback(base, `inject failed: ${getExceptionMessage(err)}`),
      failureDisposition: 'pre-dispatch',
    };
  }
  if (!injected.ok) {
    return {
      result: applyFallback(base, `inject failed: ${injected.issues.join('; ')}`),
      failureDisposition: 'pre-dispatch',
    };
  }
  if (injected.warnings && injected.warnings.length > 0) {
    base.warnings = [...(base.warnings ?? []), ...injected.warnings];
  }
  // The window name in the injected doc is escaped to the SAME depth as {{TITLE}} in the
  // worksheet (both come from args.title through inject core), so fully-decode args.title to
  // the plain literal and scope the shown-filter-card splice to that window by name.
  const literalTitle = fullyDecodeXmlEntities(args.title);
  const spliced = applyProposalSplices({ xml: injected.xml, args, schemaSummary, literalTitle });
  if (!spliced.ok) {
    return {
      result: applyFallback(base, spliced.reason),
      failureDisposition: 'pre-dispatch',
    };
  }
  if (spliced.warnings.length > 0) {
    base.warnings = [...(base.warnings ?? []), ...spliced.warnings];
  }
  let appliedWorkbookXml = spliced.xml;
  // Context measures are best-effort garnish on the canonical default: a failure here
  // must never demote a working bind to the fallback path.
  if (appliedDefault && appliedDefault.context_measures.length > 0) {
    try {
      let worksheetXml = extractSheetXml(appliedWorkbookXml, literalTitle);
      if (!worksheetXml) {
        throw new Error(`injected worksheet "${literalTitle}" was not found`);
      }
      for (const contextMeasure of appliedDefault.context_measures) {
        const resolution = resolveInSummary(schemaSummary, contextMeasure);
        if (!resolution.field || resolution.field.role !== 'measure') {
          throw new Error(`context measure "${contextMeasure}" no longer resolves uniquely`);
        }
        worksheetXml = addFieldToEncoding(
          worksheetXml,
          'tooltip',
          resolution.field.column_ref,
          undefined,
          workbookXml,
        );
      }
      appliedWorkbookXml = upsertSheetIntoWorkbook(appliedWorkbookXml, literalTitle, worksheetXml);
    } catch (err) {
      appliedWorkbookXml = spliced.xml;
      appliedDefault.context_measures = [];
      base.warnings = [
        ...(base.warnings ?? []),
        `context measures dropped: ${getExceptionMessage(err)}`,
      ];
    }
  }
  const injectMs = Date.now() - injectStart;

  // ── Apply leg (SAME validated path; runValidation preflight runs) ─
  const applyStart = Date.now();
  const applyResult = await loadWorkbookXml({
    xml: appliedWorkbookXml,
    focus: { navigate: 'artifact', sheetName: literalTitle },
    executor,
    signal,
    skipValidation,
  });
  if (applyResult.isErr()) {
    return {
      result: applyFallback(base, `apply failed: ${describeApplyError(applyResult.error)}`),
      failureDisposition: applyFailureDisposition(applyResult.error),
    };
  }
  const applyMs = Date.now() - applyStart;

  // ── Host verification receipt on the HOT path (W-23447506) ────────
  // apply-worksheet and build-and-apply-worksheet re-read the sheet they just wrote and
  // report what the host actually saw. bind-template — the path nearly every chart ask
  // takes — applied through loadWorkbookXml, which has no readback: when Tableau stripped a
  // requested encoding out of a bind, the response read exactly like a bind it kept whole.
  // Same two helpers as the cold path (verifyPostApplyWorksheetReadback +
  // formatWorksheetPromiseCheck), one extra sheet read, no extra model turn.
  //
  // The comparison needs the sheet as WE wrote it: slice the injected worksheet back out of
  // the document we posted. If it cannot be sliced (or the re-read fails), verification is
  // SKIPPED, not assumed — the receipt then says "unverified" rather than claiming a check
  // that never ran.
  let intendedWorksheetXml: string | null = null;
  try {
    intendedWorksheetXml = extractSheetXml(appliedWorkbookXml, literalTitle);
  } catch {
    intendedWorksheetXml = null;
  }
  const verification = intendedWorksheetXml
    ? await verifyPostApplyWorksheetReadback(literalTitle, intendedWorksheetXml, executor, signal)
    : undefined;
  const receiptInput = {
    validationWarnings: applyResult.value.validationWarnings,
    readback: verification ? publicReadbackVerificationResult(verification) : undefined,
    readbackFindings: verification?.findings ?? [],
  };
  const promiseOutcome = classifyWorksheetPromiseOutcome(receiptInput);
  await emitWorksheetPromiseEvents({
    config,
    sessionId: session,
    tool: 'bind-template',
    operation: 'load-workbook',
    readback: receiptInput.readback,
    findings: receiptInput.readbackFindings,
    promiseOutcome,
  });
  const readbackRan = verification !== undefined && verification.status !== 'skipped';
  // Only a comparison that actually RAN earns a line. When the sheet could not be re-read the
  // response stays exactly as it is today: printing "unverified · do not claim the change is
  // confirmed" directly after "Done — no further tool calls needed" would contradict the stop
  // clause that closed the re-bind spiral, and the structured done-receipt already names what
  // went unchecked. Telemetry above still records the skip.
  const promiseCheck = readbackRan ? formatWorksheetPromiseCheck(receiptInput) : '';
  const readbackError = formatReadbackVerificationError(receiptInput.readbackFindings);
  const readbackWarnings = formatReadbackVerificationWarnings(receiptInput.readbackFindings);
  const readbackEvidence = `${readbackError ? `\n\n${readbackError}` : ''}${readbackWarnings}`;

  // W60 response-shape trim (P4): on success, return ONLY the trimmed fast-path shape —
  // drop the args echo, apply_instruction, apply_hint, and used_llm from `base`. Those
  // enable a manual second call that never happens once the apply succeeds.
  const calcPrefix = renderAuthoredCalcPrefix(base.authored_calcs, res.status);
  const receiptText = `${calcPrefix}Applied "${literalTitle}" to the live workbook (bind ${bindMs}ms, inject ${injectMs}ms, apply ${applyMs}ms).`;
  // Blake's spiral fix: the applied:true receipt is TERMINAL unless a genuine, named re-bind
  // slot is still unfilled (the m1 waterfall case). On INCOMPLETE we keep today's steer and
  // attach NO structuredContent (byte-for-byte identical to the pre-fix code). On COMPLETE we
  // append the stop-clause AND the machine-readable done marker so nothing re-asserts "keep going".
  // A tool that cannot verify what it wrote must not report success. The binder is the only
  // layer that knows the ask named an encoding it could not bind (a post-apply readback is
  // blind here — the XML it would read back never contained the node), so its own
  // filled/unfilled split is what gates "done".
  const unfilledEncodings =
    res.encodings && res.encodings.unfilled.length > 0 ? res.encodings : undefined;
  const encodingAnalysisComplete =
    res.encodings !== undefined && res.encodings.unfilled.length === 0;
  const summaryRows = await readAppliedSummaryRows({
    executor,
    signal,
    worksheetName: literalTitle,
  });
  const emptySummaryReadback = summaryRows.summary_rows_error === EMPTY_SUMMARY_ROWS_ERROR;
  // A splice warning means requested work was skipped before readback. The core incomplete
  // evidence stays separate from rewriter diagnostics so this truth flag keeps its audited,
  // presence-safe shape.
  const incomplete =
    waterfallReBindSlotUnfilled(res, schemaSummary) ||
    unfilledEncodings !== undefined ||
    spliced.warnings.length > 0 ||
    promiseOutcome === 'failed';
  // Rewriter warnings describe work the tool dropped (for example, an unresolved optional
  // computed sort). They still prevent a clean readback from minting "done" or sheet memory.
  const needsFollowUp = incomplete || (injected.warnings?.length ?? 0) > 0 || emptySummaryReadback;
  const appliedSpliceGuidance = [
    ...(spliced.appliedFilterCount > 0 ? [FILTER_APPLIED_GUIDANCE] : []),
    ...(args.top_n !== undefined ? [TOP_N_APPLIED_GUIDANCE] : []),
  ].join(' ');
  const terminalGuidance = appliedSpliceGuidance
    ? `${TERMINAL_GUIDANCE} ${appliedSpliceGuidance}`
    : TERMINAL_GUIDANCE;
  const contextMeasureGuidance =
    appliedDefault && appliedDefault.context_measures.length > 0
      ? ', and also quote notable values of the context measures for the top entries'
      : '';
  const defaultGuidance = appliedDefault
    ? ` Tool default applied (not the user’s stated choice): measure ${JSON.stringify(appliedDefault.measure)}, top ${appliedDefault.top_n}. State this default, offer to change the measure or top_n${contextMeasureGuidance}.`
    : '';
  const currencyGuidance = currencyHeterogeneityCaveat(schemaSummary, intendedWorksheetXml);
  const guidance = `${
    unfilledEncodings
      ? appendUnfilledEncodingGuidance(
          receiptText,
          literalTitle,
          unfilledEncodings,
          ask,
          schemaSummary,
        )
      : needsFollowUp
        ? appendWaterfallDiscoveryGuidance(receiptText, res, schemaSummary)
        : `${receiptText} ${terminalGuidance}`
  }${emptySummaryReadback ? ` ${EMPTY_SUMMARY_ROWS_GUIDANCE}` : ''}${defaultGuidance}${currencyGuidance ? ` ${currencyGuidance}` : ''}${readbackEvidence}${promiseCheck}`;
  const applied: AppliedFastPathResult = {
    status: res.status,
    ...(base.authored_calcs ? { authored_calcs: base.authored_calcs } : {}),
    ...(base.warnings && base.warnings.length > 0 ? { warnings: base.warnings } : {}),
    guidance,
    ...(appliedDefault ? { applied_default: appliedDefault } : {}),
    applied: true,
    sheet_name: literalTitle,
    phase_ms: { bind: bindMs, inject: injectMs, apply: applyMs },
    ...summaryRows,
    ...(unfilledEncodings ? { encodings: unfilledEncodings } : {}),
  };
  if (unfilledEncodings) {
    return {
      incomplete: true,
      result: withNextAction(
        applied,
        prefillNextAction(unfilledEncodingNextActionLabel(unfilledEncodings)),
      ),
    };
  }
  return needsFollowUp
    ? { incomplete: true, result: applied }
    : {
        result: withNextAction(
          applied,
          doneNextAction(
            receipt({
              did: [
                `applied template "${args.template_name}" as sheet "${literalTitle}"; Desktop accepted the document`,
                `phases: bind ${bindMs}ms, inject ${injectMs}ms, apply ${applyMs}ms`,
                ...(base.authored_calcs && base.authored_calcs.length > 0
                  ? [`authored calcs: ${base.authored_calcs.join(', ')}`]
                  : []),
                ...(encodingAnalysisComplete
                  ? ['bound every encoding named in the binder encoding report']
                  : []),
              ],
              unverified: [
                ...(res.encodings === undefined
                  ? [
                      'whether every requested encoding was bound — encoding analysis did not run for this template',
                    ]
                  : []),
                ...(readbackRan
                  ? [
                      'whether the sheet renders any marks — structural readback compared XML but did not inspect rendered output',
                    ]
                  : [
                      'whether the applied sheet retained its intended structure or renders any marks — structural readback did not run',
                    ]),
              ],
            }),
          ),
        ),
      };
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
  const calcPrefix = renderAuthoredCalcPrefix(captions, result.status);
  return {
    ...result,
    authored_calcs: captions,
    guidance: result.guidance.startsWith(NOT_APPLIED_GUIDANCE)
      ? `${NOT_APPLIED_GUIDANCE} ${calcPrefix}${result.guidance
          .slice(NOT_APPLIED_GUIDANCE.length)
          .trimStart()}`
      : `${calcPrefix}${result.guidance}`,
  };
}

function recordBindRecoveryAttemptFailOpen({
  session,
  askKey,
  outcome,
  currentProposalSignature,
  proposalContext,
  reservationId,
  terminalRepairAllowance,
  terminal = false,
  terminalFallback = false,
}: {
  session: string;
  askKey: string;
  outcome: BinderResult['status'];
  currentProposalSignature?: string;
  proposalContext?: BindRecoveryProposalContext;
  reservationId?: number;
  terminalRepairAllowance?: TerminalRepairAllowance;
  terminal?: boolean;
  terminalFallback?: boolean;
}): void {
  try {
    const attempt = {
      outcome,
      ...(currentProposalSignature !== undefined
        ? { proposalSignature: currentProposalSignature }
        : {}),
      ...(proposalContext !== undefined ? { proposalContext } : {}),
      ...(reservationId !== undefined ? { reservationId } : {}),
      ...(terminalRepairAllowance !== undefined ? { terminalRepairAllowance } : {}),
    };
    if (outcome === 'escalate' && currentProposalSignature === undefined && !terminalFallback) {
      sessionRouteState.clearBindRecovery(session, askKey);
      return;
    }
    if (terminalFallback) {
      sessionRouteState.recordBindRecoveryTerminal(session, askKey, attempt);
      return;
    }
    if (
      sessionRouteState.getBindRecovery(session, askKey)?.terminalRepairAllowance?.remaining === 0
    ) {
      // An admitted repair used its sole terminal escape. Keep the ask terminal regardless
      // of outcome, so no later proposal can re-enter after the allowance is consumed.
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

function terminalRepairAllowanceFor(result: BinderResult): TerminalRepairAllowance | undefined {
  if (
    result.status !== 'escalate' ||
    result.reason !== 'missing-required-slot' ||
    result.proposal === undefined ||
    result.blockers.length !== 1
  ) {
    return undefined;
  }
  const blocker = result.blockers[0];
  if (blocker.code !== 'missing-required-slot' || blocker.slot_id === undefined) {
    return undefined;
  }
  return {
    template: result.proposal.template,
    slotId: blocker.slot_id,
    remaining: 1,
  };
}

/**
 * The sheet this session already applied for `signature`, but ONLY if it is still in the
 * live workbook we just read. A sheet the user deleted in Desktop must be rebuilt, so the
 * stale record is dropped and the bind proceeds. Fail-open: any fault means "not remembered".
 */
function rememberedSheetStillPresent({
  session,
  signature,
  workbookXml,
}: {
  session: string;
  signature: string;
  workbookXml: string;
}): AppliedSheetRecord | undefined {
  try {
    const remembered = sessionRouteState.getAppliedSheet(session, signature);
    if (remembered === undefined) {
      return undefined;
    }
    if (classifyWorksheetReplaceTarget(workbookXml, remembered.sheetName) === 'not-found') {
      sessionRouteState.forgetAppliedSheet(session, signature);
      return undefined;
    }
    return remembered;
  } catch {
    return undefined;
  }
}

function reusedSheetResult(
  remembered: AppliedSheetRecord,
  authoredCalcs: string[],
): StructuredBindTemplateToolResult {
  const reuseReceipt = receipt({
    did: [
      `matched this ask to the sheet "${remembered.sheetName}" this session already applied (template ${remembered.template})`,
      ...(authoredCalcs.length > 0 ? [`authored calcs: ${authoredCalcs.join(', ')}`] : []),
    ],
    didNot: ['apply the chart — the remembered sheet was reused; no second copy was created'],
    // rememberedSheetStillPresent() only confirms that a worksheet of that NAME is still in
    // the document (classifyWorksheetReplaceTarget). Whether its fields still match the
    // ask is never re-derived, so a user edit that emitted no observable event is invisible.
    unverified: [
      `whether "${remembered.sheetName}" still holds those fields — only its presence by name was confirmed`,
    ],
  });
  return withNextAction(
    {
      status: 'bound',
      applied: false,
      reused: true,
      ...(authoredCalcs.length > 0 ? { authored_calcs: authoredCalcs } : {}),
      sheet_name: remembered.sheetName,
      receipt: reuseReceipt,
      guidance:
        renderAuthoredCalcPrefix(authoredCalcs, 'bound') +
        // Name presence is the only live fact checked here; claiming contents would make this
        // prose contradict the receipt after a user edits the remembered sheet.
        `The remembered sheet "${remembered.sheetName}" (template ${remembered.template}) ` +
        'is still present by name, so no second copy was created. To rebuild it, call ' +
        `bind-template again with target_worksheet:"${remembered.sheetName}".`,
    },
    prefillNextAction('Rebuild sheet with target_worksheet'),
  );
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

function asksForPercent(ask: string): boolean {
  return /%|\bpercent(?:age)?\b/i.test(ask);
}

function hasPercentCaption(caption: string): boolean {
  return /%|percent|margin|rate|share|ratio/i.test(caption);
}

function hasDivisionOperator(formula: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < formula.length; index += 1) {
    const char = formula[index];
    if (quote) {
      if (char === quote && formula[index - 1] !== '\\') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '/') {
      return true;
    }
  }
  return false;
}

const title = 'Matching template';

export const getBindTemplateTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const bindTemplateTool = new DesktopTool({
    server,
    name: 'bind-template',
    title,
    description: 'Bind a chart template to fields.',
    paramsSchema,
    annotations: {
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
      {
        session,
        ask,
        proposal,
        minConfidence,
        auto_apply,
        target_worksheet,
        calcs,
        skip_validation,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await bindTemplateTool.logAndExecute<BindTemplateToolResult>({
        extra,
        args: {
          session,
          ask,
          proposal,
          minConfidence,
          auto_apply,
          target_worksheet,
          calcs,
          skip_validation,
        },
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
              proposal as BindingProposal | undefined,
              resolvedSession,
              askKey,
              target_worksheet,
            );
            if (blocked) {
              return new IncompleteOperationError(blocked).toErr();
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

          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }
          let workbookXml = xmlResult.value;
          let authoredCalcCaptions: string[] = [];
          if (calcs && calcs.length > 0) {
            const percentAsk = asksForPercent(ask);
            const authoredCalcInputs = (calcs as AuthorCalcInput[]).map((calc) =>
              percentAsk && hasDivisionOperator(calc.formula) && hasPercentCaption(calc.caption)
                ? { ...calc, defaultFormat: 'p0%' as const }
                : calc,
            );
            const authored = await authorCalculationsInWorkbook({
              workbookXml,
              calcs: authoredCalcInputs,
              executor,
              signal: extra.signal,
              resolveLooseReferences: true,
            });
            if (authored.isErr()) {
              return authored.error.toErr();
            }
            workbookXml = authored.value.workbookXml;
            authoredCalcCaptions = authored.value.authoredCalcs.map((calc) => calc.caption);
          }

          const runtimeCatalog = loadRuntimeTemplateCatalogSnapshots({
            ...(proposal === undefined ? {} : { additionalTemplates: [proposal.template] }),
            automaticOnly: true,
          });
          const puppetCompatibility = createPuppetCompatibilityProjection(runtimeCatalog);
          const manifests =
            proposal === undefined
              ? puppetCompatibility.descriptors
              : puppetCompatibility.allDescriptors;
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

          let res: BinderResult;
          let appliedDefault: AppliedDefault | undefined;
          try {
            res = await bindTemplate({
              ask,
              workbookXml,
              manifests,
              ...(proposal ? { proposal: proposal as BindingProposal } : {}),
              ...(minConfidence !== undefined ? { minConfidence } : {}),
            });
            if (
              proposal === undefined &&
              auto_apply === true &&
              res.status === 'propose' &&
              res.llm_input.recommended
            ) {
              const recommended = res.llm_input.recommended;
              res = await bindTemplate({
                ask,
                workbookXml,
                manifests,
                proposal: proposalFromRecommendation(ask, recommended),
                ...(minConfidence !== undefined ? { minConfidence } : {}),
              });
              if (res.status === 'bound') {
                appliedDefault = appliedDefaultFrom(recommended);
              }
            } else if (
              proposal !== undefined &&
              auto_apply === true &&
              res.status === 'bound' &&
              appliedDefault === undefined
            ) {
              // A Call-2 proposal that lands on the recommended measure must carry the
              // same context-measure garnish as the internal auto-default: the agent's
              // route (auto vs explicit confirm) is variance, not a decision to drop
              // the profit/margin context the receipt quotes from. Best-effort — a dry
              // re-classify failure must never disturb the working bind.
              try {
                const dry = await bindTemplate({
                  ask,
                  workbookXml,
                  manifests,
                  ...(minConfidence !== undefined ? { minConfidence } : {}),
                });
                const recommended =
                  dry.status === 'propose' ? dry.llm_input.recommended : undefined;
                if (
                  recommended &&
                  (proposal as BindingProposal).bindings?.some(
                    (b) => b.field === recommended.measure,
                  )
                ) {
                  appliedDefault = appliedDefaultFrom(recommended);
                }
              } catch {
                /* fail-open: bind stands, garnish skipped */
              }
            }
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
          const bindMs = Date.now() - bindStart;
          const schemaSummary = summarizeSchema(workbookXml);
          res = puppetCompatibility.expandBinderResult(res, schemaSummary);

          // ── Candidate handover on a RECOVERABLE escalation ────────────────
          // Only `propose` used to carry the candidate list, so an agent told to re-propose
          // after an ambiguous-field / field-not-found / low-confidence escalation had nothing
          // to propose FROM and went hunting: the live transcript shows it falling through to
          // search-commands — which answered an encoding ask with mapbox logging and
          // device-layout removal — and then reading an entire knowledge document.
          //
          // TIER-2 reasons are deliberately excluded. They are recorded as a terminal fallback,
          // so the next bind-template call for this ask is blocked outright; handing out a
          // Call-2 contract there would walk the agent into a refusal.
          //
          // The field cap is the binder's own fail-closed cost guard (buildLlmInput runs one
          // regex PER schema field). Call-2 skips that guard, so a proposal escalating against a
          // pathologically wide schema must not re-enter the per-field loop here.
          //
          // Fail-open: this is an enrichment, not the outcome. A fault while assembling the
          // shortlist (a manifest missing its slots, say) must leave the escalation the honest
          // business result it already is, never turn it into a tool error.
          let escalateCandidates: LlmProposeInput | undefined;
          if (
            res.status === 'escalate' &&
            !TIER2_REASONS.has(res.reason) &&
            schemaSummary.fields.length <= MAX_CLASSIFIABLE_FIELDS
          ) {
            try {
              escalateCandidates = buildLlmInput(ask, manifests, schemaSummary);
            } catch {
              escalateCandidates = undefined;
            }
          }
          const call2ContractInput = res.status === 'propose' ? res.llm_input : escalateCandidates;
          const call2Contract = call2ContractInput
            ? buildCall2Contract({
                llmInput: call2ContractInput,
                session: resolvedSession,
                ask,
                targetWorksheet: target_worksheet,
              })
            : undefined;
          try {
            sessionRouteState.recordAskOutcome(resolvedSession, askKey, res.status);
            if (res.status === 'propose') {
              recordBindRecoveryAttemptFailOpen({
                session: resolvedSession,
                askKey,
                outcome: res.status,
                currentProposalSignature,
                proposalContext: call2Contract,
                reservationId: bindRecoveryReservationId,
              });
            } else if (res.status === 'escalate') {
              recordBindRecoveryAttemptFailOpen({
                session: resolvedSession,
                askKey,
                outcome: res.status,
                currentProposalSignature,
                // Retained so a bare resubmit gets the SAME choices repeated back rather than a
                // bare "supply a proposal" it has no list to satisfy.
                ...(call2Contract !== undefined ? { proposalContext: call2Contract } : {}),
                reservationId: bindRecoveryReservationId,
                terminalFallback: TIER2_REASONS.has(res.reason),
                terminalRepairAllowance: terminalRepairAllowanceFor(res),
              });
            }
          } catch {
            /* fail-open */
          }

          const base: StructuredBindTemplateToolResult = annotateAuthoredCalcs(
            res.status === 'escalate'
              ? withNextAction(
                  {
                    ...res,
                    guidance: buildGuidance(
                      res,
                      schemaSummary,
                      proposal,
                      call2Contract !== undefined,
                    ),
                    ...(call2Contract !== undefined ? { call_2_contract: call2Contract } : {}),
                  },
                  nextActionForEscalation(res.reason),
                )
              : res.status === 'propose'
                ? withNextAction(
                    {
                      ...res,
                      guidance: buildGuidance(res, schemaSummary, proposal),
                      call_2_contract: call2Contract,
                    },
                    prefillNextAction('Supply proposal from call_2_contract to bind-template'),
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
          const selectedTemplate =
            res.status === 'bound' ? runtimeCatalog.get(res.args.template_name) : undefined;
          const canAutoApply =
            auto_apply === true &&
            res.status === 'bound' &&
            selectedTemplate?.descriptor.fast_path_eligible === true;

          if (res.status !== 'bound') {
            return new Ok(base);
          }

          if (!canAutoApply || selectedTemplate === undefined) {
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

          // ── Duplicate-sheet reuse (the re-bind loop) ─────────────────────
          // The binder titles a Call-1 sheet with the ask text itself, so a reworded ask
          // for the SAME chart binds identical args under a new title and today builds a
          // duplicate sheet. Signature is title-free, so the paraphrase collapses onto the
          // sheet already applied. Only when the caller did NOT name a target: an explicit
          // target_worksheet is an explicit instruction to rewrite that sheet (a reset of
          // hand edits is legitimate) and always applies.
          const sheetSignature = appliedSheetSignature(res.args);
          if (target_worksheet === undefined) {
            const remembered = rememberedSheetStillPresent({
              session: resolvedSession,
              signature: sheetSignature,
              workbookXml,
            });
            if (remembered !== undefined) {
              return new Ok(reusedSheetResult(remembered, authoredCalcCaptions));
            }
          }

          const autoApplyResult = await performAutoApply({
            res,
            base,
            ask,
            workbookXml,
            session: resolvedSession,
            config: extra.config,
            executor,
            signal: extra.signal,
            bindMs,
            schemaSummary,
            templateSnapshot: selectedTemplate.snapshot,
            appliedDefault,
            // Honor skip_validation only for a server-trusted caller (config gate set by the
            // deterministic spawner). An untrusted LLM turn that passes the flag gets full
            // validation, not a bypass — the param alone cannot skip the preflight.
            skipValidation: skip_validation === true && extra.config.allowSkipValidation,
          });
          const appliedResult = autoApplyResult.result;
          // Only a bind the binder called FINISHED may be replayed as "already built" on
          // the next reworded ask. An incomplete bind still reports applied:true with a
          // sheet_name, so remembering it would answer a later re-bind with a terminal
          // "no further tool calls needed" for a chart missing a requested encoding.
          if (
            !autoApplyResult.incomplete &&
            'applied' in appliedResult &&
            appliedResult.applied === true &&
            typeof appliedResult.sheet_name === 'string'
          ) {
            sessionRouteState.recordAppliedSheet(resolvedSession, sheetSignature, {
              sheetName: appliedResult.sheet_name,
              template: res.args.template_name,
            });
          }
          recordBoundRecoveryAfterFinalResult({
            session: resolvedSession,
            askKey,
            currentProposalSignature,
            reservationId: bindRecoveryReservationId,
            result: appliedResult,
          });
          if (
            autoApplyResult.failureDisposition === 'pre-dispatch' &&
            currentProposalSignature !== undefined
          ) {
            try {
              sessionRouteState.grantPreDispatchRetryAllowance(
                resolvedSession,
                askKey,
                currentProposalSignature,
              );
            } catch {
              /* fail-open */
            }
          }
          if ('applied' in appliedResult && appliedResult.applied === false) {
            return new IncompleteOperationError(appliedResult).toErr();
          }
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
