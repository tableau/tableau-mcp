import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';
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
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { DesktopDiscoverer } from '../../../desktop/desktopDiscoverer.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { getTemplatePath } from '../../../desktop/templates/templatePath.js';
import { ExecuteCommandError, ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  type McpToolError,
  NoDesktopInstancesFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
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
    .describe(
      'Tableau instance Session ID from list-instances. Optional: when omitted and exactly one Desktop instance is running, it is resolved automatically; with 0 or 2+ instances the tool fails closed and lists the instances.',
    ),
  ask: z.string().describe("Natural-language chart request, e.g. 'bar chart of Sales by Region'."),
  proposal: proposalSchema
    .optional()
    .describe(
      "Call 2 only: the binding proposal you produced from a Call-1 'propose' payload (must match its output_schema).",
    ),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Confidence floor for a proposal (default 0.6). Below this, the binder escalates.'),
  auto_apply: z
    .boolean()
    .optional()
    .describe(
      'When true AND this is a deterministic Call-1 bind (no proposal) of a fast-path-eligible template, apply the bound template server-side (get workbook XML → inject → validated apply) and return { applied, sheet_name, phase_ms }. On any inject/apply failure the bound args are returned intact with { applied:false, apply_error } so you can fall back to the manual inject/apply chain. Never auto-applies a Call-2 proposal. Default false (read-only).',
    ),
};

/**
 * Result of one bind-template call: the binder outcome plus a plain-text next step.
 * When auto_apply performs (or attempts) a server-side apply, the applied fields are
 * present: `applied` + either `sheet_name`/`phase_ms` (success) or `apply_error`
 * (graceful fallback — the bound `args` are still intact).
 */
type BindTemplateToolResult = BinderResult & {
  guidance: string;
  applied?: boolean;
  sheet_name?: string;
  phase_ms?: { bind: number; inject: number; apply: number };
  apply_error?: string;
};

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
      'Resolve the field(s) with the resolve-field tool, then call bind-template again with a corrected proposal.';
  } else if (reason === 'low-confidence') {
    next =
      'Confidence was below the floor. Re-examine the candidate template(s), pick the best fit, and re-propose with higher confidence.';
  } else if (TIER2_REASONS.has(reason)) {
    next =
      'This ask is not a fast-path template bind. Author the worksheet with the general field/worksheet build tools instead.';
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
        `${DERIVATION_OVERRIDE_INSTRUCTION}.`
      );
    case 'escalate':
      return renderEscalationGuidance(res.reason, res.blockers);
  }
}

/**
 * Session-default-when-unique (bind-template only): with an explicit `session` the
 * caller always wins; with none, resolve automatically ONLY when exactly one Desktop
 * instance is running. 0 or 2+ instances fail closed with an instance-listing error
 * so the caller must pick one — this deletes the list-instances turn from the common
 * single-Desktop case without ever guessing between multiple instances.
 */
function resolveSession(session: string | undefined): Result<string, McpToolError> {
  if (session !== undefined) {
    return Ok(session);
  }

  const instances = new DesktopDiscoverer().getInstances();
  if (instances.size === 0) {
    return Err(new NoDesktopInstancesFoundError());
  }
  if (instances.size > 1) {
    const ids = Array.from(instances.values())
      .map((i) => i.pid)
      .join(', ');
    return Err(
      new ArgsValidationError(
        `Multiple Tableau Desktop instances are running (session IDs: ${ids}). Specify which one to use via the 'session' parameter (see list-instances for details).`,
      ),
    );
  }

  const [only] = Array.from(instances.values());
  return Ok(String(only.pid));
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
    return 'invalid workbook XML';
  }
  return `workbook load command failed: ${JSON.stringify(error.error)}`;
}

type BoundResult = Extract<BinderResult, { status: 'bound' }>;

/** sha256 of the workbook XML — used by the staleness hash gate (W60 P1-6). */
function hashWorkbookXml(xml: string): string {
  return createHash('sha256').update(xml).digest('hex');
}

/** Build the graceful-fallback result: the bound args are intact + why apply didn't run. */
function applyFallback(base: BindTemplateToolResult, apply_error: string): BindTemplateToolResult {
  return {
    ...base,
    guidance: `Server-side auto-apply did not complete (${apply_error}). The bound args are intact — fall back to the manual chain: get-workbook-xml → inject-template → apply-workbook using the returned args.`,
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
  workbookHash,
  session,
  executor,
  signal,
  bindMs,
  eventsAnchor,
}: {
  res: BoundResult;
  base: BindTemplateToolResult;
  workbookXml: string;
  workbookHash: string;
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
          're-run bind-template for a fresh read, or apply the returned args manually after reviewing',
      );
    }
  }

  // ── Inject leg (shared core) ─────────────────────────────────────
  const injectStart = Date.now();
  let injected: ReturnType<typeof buildInjectedWorkbookXml>;
  try {
    const templateXml = readFileSync(getTemplatePath(args.template_name), 'utf-8');
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

  // ── Staleness hash gate (W60 P1-6 — transport-agnostic) ───────────
  // Independent of the events-clean gate above: works with zero support from the
  // executor (no getEvents needed), so it's the ONLY staleness protection the Athena
  // transport gets today (its getEvents always Errs — see externalApiToolExecutor.ts).
  // Re-reads the live workbook right before dispatch and compares against the hash
  // taken at the original read; any change in between (including changes the
  // events-gate should have caught but couldn't, on transports where it's unsupported)
  // is refused. Costs one extra round-trip on every auto_apply — accepted: this path
  // writes the whole document, last-writer-wins, so the safety property is worth it.
  const rehashResult = await getWorkbookXml({ executor, signal });
  if (rehashResult.isErr()) {
    return applyFallback(
      base,
      `staleness re-check failed: could not re-read the workbook before apply (${JSON.stringify(
        rehashResult.error,
      )})`,
    );
  }
  if (hashWorkbookXml(rehashResult.value) !== workbookHash) {
    return applyFallback(
      base,
      'workbook changed since the read that produced this bind (staleness hash mismatch) — ' +
        're-run bind-template for a fresh read, or apply the returned args manually after reviewing the current workbook',
    );
  }

  // ── Apply leg (SAME validated path; runValidation preflight runs) ─
  const applyStart = Date.now();
  const applyResult = await loadWorkbookXml({ xml: injected.xml, executor, signal });
  const applyMs = Date.now() - applyStart;
  if (applyResult.isErr()) {
    return applyFallback(base, `apply failed: ${describeApplyError(applyResult.error)}`);
  }

  return {
    ...base,
    guidance: `Applied server-side: injected template "${args.template_name}" and applied worksheet "${args.title}" to the live workbook via the validated apply path (bind ${bindMs}ms, inject ${injectMs}ms, apply ${applyMs}ms).`,
    applied: true,
    sheet_name: args.title,
    phase_ms: { bind: bindMs, inject: injectMs, apply: applyMs },
  };
}

const title = 'Bind a Chart Template to an Ask (Fast Path)';

export const getBindTemplateTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const bindTemplateTool = new DesktopTool({
    server,
    name: 'bind-template',
    title,
    description: [
      'Deterministically bind a checked-in chart template to a natural-language ask and return validated inject args — a fast one-shot alternative to authoring a worksheet from scratch.',
      'Reads the live workbook XML for the given session, loads the bundled template manifests, and runs the two-call binder (this server is model-free — it never calls a small model):',
      "Call 1 { session, ask }: no-LLM keyword classification + role-greedy field binding. Returns status 'bound' with inject args, or status 'propose' with an llm_input (candidate templates + fields) and a strict output_schema for YOU to fill.",
      "Call 2 { session, ask, proposal }: validates your proposal through the deterministic gate and returns status 'bound' or status 'escalate' with actionable guidance.",
      "'bound' returns the args and an apply_instruction; 'propose' and 'escalate' are normal outcomes (not tool errors) carrying next-step guidance.",
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
          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }
          const workbookHashAtRead = hashWorkbookXml(xmlResult.value);

          // Events-clean anchor (W60 blind-spot #1): apply is whole-document
          // last-writer-wins, so a user edit made in Desktop between this read and
          // the auto-apply would be silently reverted. Anchor the event sequence
          // now; performAutoApply refuses to apply over a dirty workbook. Best-
          // effort: an executor without event support proceeds (surfaced in the
          // result as events_gate 'unavailable') rather than disabling auto_apply.
          let eventsAnchor: number | undefined;
          if (auto_apply === true) {
            const anchor = await executor.getEvents({ signal: extra.signal });
            if (anchor.isOk()) {
              eventsAnchor = anchor.value.latest_sequence;
            }
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
          const res = await bindTemplate({
            ask,
            workbookXml: xmlResult.value,
            manifests,
            ...(proposal ? { proposal: proposal as BindingProposal } : {}),
            ...(minConfidence !== undefined ? { minConfidence } : {}),
          });
          const bindMs = Date.now() - bindStart;

          const base: BindTemplateToolResult = { ...res, guidance: buildGuidance(res) };

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
              workbookHash: workbookHashAtRead,
              session: resolvedSession,
              executor,
              signal: extra.signal,
              bindMs,
              eventsAnchor,
            }),
          );
        },
      });
    },
  });

  return bindTemplateTool;
};
