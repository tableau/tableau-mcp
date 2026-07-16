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
} from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import { classifyAskRoute, normalizeAskForMatch } from '../../../desktop/binder/route-spec.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import { ExecuteCommandError, ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
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

const paramsSchema = {
  session: z
    .string()
    .optional()
    .describe('Session; optional when one Desktop instance is running.'),
  ask: z.string().describe('Viz ask.'),
  proposal: proposalSchema.optional().describe("Call 2 only: filled proposal from a Call-1 'propose' payload."),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence floor; default 0.6.'),
  auto_apply: z
    .boolean()
    .optional()
    .describe(
      'True applies deterministic Call-1 binds server-side; never auto-applies Call-2 proposals. Default false/read-only.',
    ),
};

/**
 * Result of one bind-template call: the binder outcome plus a plain-text next step.
 * When auto_apply performs (or attempts) a server-side apply, the applied fields are
 * present: `applied` + either `sheet_name`/`phase_ms` (success) or `apply_error`
 * (graceful fallback — the bound `args` are still intact).
 */
type BindTemplateToolResultBase = BinderResult & {
  guidance: string;
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
  sheet_name: string;
  phase_ms: { bind: number; inject: number; apply: number };
  guidance: string;
};

type BindTemplateToolResult = BindTemplateToolResultBase | AppliedFastPathResult;
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

function nextActionForEscalation(reason: EscalateReason): NextAction {
  if (reason === 'ambiguous-field' || reason === 'field-not-found') {
    return prefillNextAction('Resolve the fields first; otherwise ask the user');
  }
  if (reason === 'low-confidence') {
    return prefillNextAction('Pick a higher-confidence proposal');
  }
  if (TIER2_REASONS.has(reason)) {
    return prefillNextAction('Use the general worksheet build tools');
  }
  return prefillNextAction('Build the worksheet manually');
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
  if (reason === 'ambiguous-field' || reason === 'field-not-found') {
    next =
      'Resolve the field(s) with the resolve-field tool, then call bind-template again with a corrected proposal; otherwise ask the user with ask-user (present the candidates).';
  } else if (reason === 'low-confidence') {
    next =
      'Confidence was below the floor. Re-examine the candidate template(s), pick the best fit, and re-propose with higher confidence.';
  } else if (TIER2_REASONS.has(reason)) {
    next =
      'This ask is not a fast-path template bind. Author the worksheet with the general field/worksheet build tools instead. ' +
      'If a blocker names a real but not-fast-path-eligible template, that template can still be applied via the manual chain: ' +
      'get workbook structure in file mode -> inject-template (that template_name + an explicit field_mapping) -> apply-workbook.';
  } else {
    next = 'Author the worksheet with the general build tools instead.';
  }
  return `Escalated (${reason}). No worksheet was produced. Blockers: ${renderBlockers(
    blockers,
  )}. Next: ${next}`;
}

function buildGuidance(res: BinderResult): string {
  switch (res.status) {
    case 'bound':
      return res.apply_instruction || APPLY_INSTRUCTION;
    case 'propose':
      return (
        'No deterministic (no-LLM) match. Choose exactly one template from llm_input.candidate_templates, ' +
        'bind every bindable slot to a field from llm_input.fields (match role/kind; use the exact field name), ' +
        'then call bind-template again with { session, ask, proposal } matching output_schema. ' +
        // W60 pie-anyway gap: candidates carry ONLY fast-path-eligible templates, so an ask naming an
        // unstamped shape (canonically pie) dead-ended here with no honest route — name both exits.
        'If the asked viz shape is not among the candidates (e.g. pie/donut — no pie template is ' +
        'fast-path eligible), do not force a mismatched proposal: bind the nearest candidate and tell the ' +
        'user in one sentence why (for a pie ask, a sorted bar or treemap compares shares more precisely); ' +
        'if they explicitly want the exact shape anyway, use the manual chain — get workbook structure in file mode -> ' +
        "inject-template with template_name 'part-to-whole-pie-chart' (field_mapping: Region -> the " +
        'category dimension, Sales -> the measure) -> apply-workbook. ' +
        `${DERIVATION_OVERRIDE_INSTRUCTION}.`
      );
    case 'escalate':
      return renderEscalationGuidance(res.reason, res.blockers);
  }
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
  return {
    ...base,
    guidance:
      guidance ??
      `Server-side auto-apply did not complete (${apply_error}). The bound args are intact — fall back to the manual chain: get workbook structure in file mode → inject-template → apply-workbook using the returned args.`,
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
}: {
  res: BoundResult;
  base: BindTemplateToolResultBase;
  workbookXml: string;
  session: string;
  executor: ToolExecutor;
  signal: AbortSignal;
  bindMs: number;
  eventsAnchor?: number;
}): Promise<BindTemplateToolResult> {
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
        'Server-side auto-apply was refused: the user changed the workbook after it was read ' +
          `(${events.value.count} event(s) since read). Re-run bind-template so it reads the ` +
          'current workbook — do NOT re-apply the returned args, they were computed against ' +
          'the pre-edit workbook and would revert their changes.',
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
      applyNonce,
    });
  } catch (err) {
    return applyFallback(base, `inject failed: ${getExceptionMessage(err)}`);
  }
  if (!injected.ok) {
    return applyFallback(base, `inject failed: ${injected.issues.join('; ')}`);
  }
  const injectMs = Date.now() - injectStart;

  // ── Apply leg (SAME validated path; runValidation preflight runs) ─
  const applyStart = Date.now();
  const applyResult = await loadWorkbookXml({ xml: injected.xml, executor, signal });
  const applyMs = Date.now() - applyStart;
  if (applyResult.isErr()) {
    return applyFallback(base, `apply failed: ${describeApplyError(applyResult.error)}`);
  }

  // W60 response-shape trim (P4): on success, return ONLY the trimmed fast-path shape —
  // drop the args echo, apply_instruction, apply_hint, and used_llm from `base`. Those
  // enable a manual second call that never happens once the apply succeeds.
  return {
    status: res.status,
    guidance: `Applied "${args.title}" to the live workbook (bind ${bindMs}ms, inject ${injectMs}ms, apply ${applyMs}ms).`,
    applied: true,
    sheet_name: args.title,
    phase_ms: { bind: bindMs, inject: injectMs, apply: applyMs },
  };
}

const title = 'Bind a Viz Template to an Ask (Fast Path)';

export const getBindTemplateTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const bindTemplateTool = new DesktopTool({
    server,
    name: 'bind-template',
    title,
    description: [
      'Bind a checked-in template to an ask.',
      "Call 1 returns 'bound' or 'propose'; Call 2 returns 'bound' or 'escalate'.",
      'auto_apply:true renders deterministic Call-1 binds.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true, // Reads the live workbook and computes; never mutates it.
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async (
      { session, ask, proposal, minConfidence, auto_apply },
      extra,
    ): Promise<CallToolResult> => {
      return await bindTemplateTool.logAndExecute<BindTemplateToolResult>({
        extra,
        args: { session, ask, proposal, minConfidence, auto_apply },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

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
          // Caveat verified (offline, no live Desktop): the read issues only
          // `save-underlying-metadata` via getWorkbookXml — a metadata serialization/read
          // that emits no counted document event. Counted events are user `doc:*`
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
          const askKey = normalizeAskForMatch(ask);
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
          let res;
          try {
            res = await bindTemplate({
              ask,
              workbookXml: xmlResult.value,
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
          try {
            sessionRouteState.recordAskOutcome(resolvedSession, askKey, res.status);
          } catch {
            /* fail-open */
          }
          const bindMs = Date.now() - bindStart;

          const base: StructuredBindTemplateToolResult =
            res.status === 'escalate'
              ? withNextAction(
                  { ...res, guidance: buildGuidance(res) },
                  nextActionForEscalation(res.reason),
                )
              : { ...res, guidance: buildGuidance(res) };

          // ── Auto-apply gate (defense in depth) ───────────────────────────
          // Only a deterministic Call-1 bind (used_llm === false) of a fast-path-
          // eligible template auto-applies. A Call-2 proposal (used_llm === true) or
          // any non-bound outcome NEVER auto-applies, even with the flag set. Both
          // conditions are implied by a Call-1 bound result today; we assert them.
          const manifest =
            res.status === 'bound' ? manifests.get(res.args.template_name) : undefined;
          const canAutoApply =
            auto_apply === true &&
            res.status === 'bound' &&
            res.used_llm === false &&
            manifest?.fast_path_eligible === true;

          if (!canAutoApply || res.status !== 'bound') {
            return new Ok(base);
          }

          return new Ok(
            await performAutoApply({
              res,
              base,
              workbookXml: xmlResult.value,
              session: resolvedSession,
              executor,
              signal: extra.signal,
              bindMs,
              eventsAnchor,
            }),
          );
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return bindTemplateTool;
};
