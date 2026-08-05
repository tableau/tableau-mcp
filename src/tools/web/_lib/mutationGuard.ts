/**
 * Common mutation-tool safety layer for the TMCP server (W-23125362).
 *
 * Every in-scope mutation tool (delete-content, update-cloud-extract-refresh-task) routes its
 * mutation through `guardMutation` instead of
 * re-implementing its own admin check, identity resolution, confirmation gate, and audit. The guard:
 *
 *   1. Enforces the admin gate (assertAdmin) uniformly.
 *   2. Resolves the actor identity and the mutation target.
 *   3. For preview→confirm tools, runs the pluggable EvidenceStrategy: `establish` proof in the
 *      preview phase, and on confirm `verify` it against live server state — rejecting precomputed or
 *      forged confirmations exactly as #414's tag gate does.
 *   4. Emits a single authoritative AuditRecord (allowed OR denied) to the durable log sink.
 *
 * DURABILITY CONTRACT (AC-5, honest note): the authoritative audit records emitted below are
 * structured JSON written to the dedicated `audit` logger, which bypasses the LOG_LEVEL severity
 * filter (see AUDIT_LOGGER) so an operator cannot suppress them by raising LOG_LEVEL. DURABILITY
 * itself is the DEPLOYMENT's responsibility: this server emits the records to its log stream
 * (stderr/stdout/file); operators MUST ship that audit stream to their durable/immutable log store
 * (SIEM, log archive, etc.) for retention. There is no built-in durable sink here.
 *
 * AC-5 — RESIDUAL GAP (code-enforced human approval): the MCP SDK shipped with this server
 * (@modelcontextprotocol/sdk >=1.26, currently 1.29) DOES expose an elicitation primitive
 * (server.elicitInput(...)), but it is not wired in here and host/client support for it is uneven —
 * many clients do not yet implement elicitation, so the server cannot rely on it to block on an
 * interactive human approval at call time. HITL therefore remains a prompt-text contract
 * (centralized in src/prompts/_lib/confirm.ts) reinforced by the server-authoritative evidence gate
 * below — a confirmed mutation is rejected unless a preview genuinely ran. Adopting a true
 * elicitation handshake (or the app-only confirmation tool described in confirm.ts) is tracked as
 * follow-up.
 *
 * RegistryEvidence's nonce store is in-memory (see the DURABILITY CAVEAT in evidence.ts): it is not
 * durable across restart / multi-instance, but it can only ever reject (never wrongly allow), so the
 * no-bypass guarantee holds.
 */
import { Ok, Result } from 'ts-results-es';

import { AdminOnlyError, McpToolError, PreviewNotRunError } from '../../../errors/mcpToolError.js';
import { AUDIT_LOGGER, log } from '../../../logging/logger.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { assertAdmin } from '../adminGate.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { WebToolName } from '../toolName.js';
import { AuditRecord, auditRecordSchema } from './auditRecord.js';
import { EvidenceContext, EvidenceStrategy } from './evidence.js';
import { renderPreviewNotRunMessage } from './hitlText.js';

/** Identity of the principal attempting the mutation, captured for the audit record. */
export interface MutationActor {
  username?: string;
  userLuid?: string;
  siteLuid: string;
  siteName: string;
}

/** The resolved target of the mutation, captured for the audit record. */
export interface MutationTarget {
  id: string;
  name?: string;
  project?: string;
  owner?: string;
  kind: 'datasource' | 'workbook' | 'extract-refresh-task' | 'user';
}

/** What the guard hands back to the tool on success so it can build its tool-specific response. */
export interface GuardOutcome {
  actor: MutationActor;
  target: MutationTarget;
  /**
   * Records the TERMINAL outcome of a confirmed mutation's REST call. On a confirm the guard emits NO
   * 'allowed' record (that would double-log the attempt); this terminal 'completed'/'failed' record
   * is the SOLE audit entry for the confirm, so the caller MUST invoke it once the REST result is
   * known or the attempt goes unaudited. No-op on the preview phase (nothing mutates, and the preview
   * already logged its single 'allowed' record), so callers can invoke it unconditionally.
   */
  recordOutcome: (outcome: { ok: true } | { ok: false; failureDetail?: string }) => void;
}

/**
 * Routes a mutation through the common safety layer. Emits exactly one audit record (allowed or
 * denied) and returns Ok(GuardOutcome) only when the mutation is permitted to proceed.
 *
 * @param mode - 'preview-confirm' tools establish/verify evidence; 'confirm-only' tools just require
 *   `confirm: true` (resolved by the caller via `phase`) and skip establish/verify.
 * @param phase - 'preview' for the non-destructive first call, 'confirm' for the destructive call.
 */
export async function guardMutation<TTarget>({
  restApi,
  extra,
  tool,
  action,
  mode,
  phase,
  evidence,
  resolveTarget,
  confirmationToken,
  previewTool,
  binding,
  fallbackTargetKind,
}: {
  restApi: RestApi;
  extra: TableauWebRequestHandlerExtra;
  tool: WebToolName;
  action: 'delete' | 'update';
  mode: 'preview-confirm' | 'confirm-only';
  phase: 'preview' | 'confirm';
  evidence: EvidenceStrategy<TTarget>;
  resolveTarget: () => Promise<MutationTarget>;
  confirmationToken?: string;
  // The model-visible preview tool whose preview establishes the evidence this confirm verifies. Set
  // ONLY by an app-only confirm tool (`tool` !== `previewTool`): the user re-previews by re-running
  // `previewTool` and approving in the rendered panel — they never pass `confirm` to this tool, which
  // is model-invisible and takes no `confirm` arg. When omitted (model-visible preview-confirm tools
  // where preview and confirm are the SAME tool name), the recovery is "re-run `tool` with confirm
  // omitted", which is what the message says.
  previewTool?: WebToolName;
  // Optional fingerprint of the caller-controlled parameters (see EvidenceContext.binding). Bound
  // into the evidence so a confirm applies exactly what was previewed, never a swapped-in payload.
  binding?: string;
  // Optional override for the `target.kind` used in the DENIED audit fallback when `resolveTarget()`
  // itself fails. Required for polymorphic tools like `delete-content` where the caller knows the
  // dispatched resource kind but `targetKindHint(tool)` cannot derive it from the tool name alone.
  fallbackTargetKind?: MutationTarget['kind'];
}): Promise<Result<GuardOutcome, McpToolError>> {
  // (2) Build the actor identity up front so a denied attempt is still attributable in the audit.
  const actor: MutationActor = {
    username: extra.tableauAuthInfo?.username,
    userLuid: extra.getUserLuid(),
    siteLuid: extra.getSiteLuid(),
    siteName: extra.getSiteName(),
  };
  const evidenceDescriptor = evidence.describeEvidence();

  // (1) Uniform admin gate. On failure emit a DENIED audit before returning so even rejected
  // privilege escalations are recorded — but resolve the target first so the record names it.
  const adminResult = await assertAdmin(restApi, extra);
  if (adminResult.isErr()) {
    // resolveTarget() typically does a read (which may itself 403/404/network-fail). This is the
    // exact attempted-escalation event the audit surface most wants to preserve, so a lookup failure
    // must NOT swallow the DENIED record — fall back to a placeholder target instead.
    let deniedTarget: MutationTarget;
    try {
      deniedTarget = await resolveTarget();
    } catch {
      deniedTarget = { id: 'unresolved', kind: fallbackTargetKind ?? targetKindHint(tool) };
    }
    emitAuditRecord({
      actor,
      tool,
      action,
      phase,
      target: deniedTarget,
      confirmationEvidence: evidenceDescriptor,
      result: 'denied',
      denyReason: 'not-admin',
    });
    return new AdminOnlyError(adminResult.error).toErr();
  }

  // (3) Resolve the target so both the evidence gate and the audit record name exactly what was acted on.
  const target = await resolveTarget();
  const evidenceCtx: EvidenceContext = {
    restApi,
    siteId: restApi.siteId,
    target,
    tool,
    userLuid: actor.userLuid ?? '',
    confirmationToken,
    binding,
  };

  // (4) Confirm phase of a preview→confirm tool: verify the evidence against live state. A
  // precomputed or forged confirmation fails here, uniformly with #414's tag gate.
  if (phase === 'confirm' && mode === 'preview-confirm') {
    const verified = await evidence.verify(evidenceCtx);
    if (!verified) {
      emitAuditRecord({
        actor,
        tool,
        action,
        phase,
        target,
        confirmationEvidence: evidenceDescriptor,
        result: 'denied',
        denyReason: 'preview-not-run',
      });
      // An app-only confirm tool (previewTool set) recovers by re-running the preview tool and
      // approving in the rendered panel — it is model-invisible and takes no `confirm` arg, so the
      // "run with confirm omitted" recovery does not apply to it. A model-visible preview-confirm
      // tool (no previewTool) previews and confirms under the SAME name, so it recovers in place.
      // Wording single-sourced in hitlText.ts (renderPreviewNotRunMessage).
      return new PreviewNotRunError(
        renderPreviewNotRunMessage({
          tool,
          previewTool,
          targetKind: target.kind,
          targetId: target.id,
        }),
      ).toErr();
    }
  }

  // (5) Preview phase: establish the server-side proof the confirm phase will verify.
  if (phase === 'preview') {
    await evidence.establish(evidenceCtx);
  }

  // (6) Allowed: on a PREVIEW, emit the single terminal 'allowed' record — nothing mutates, so the
  // authorization decision is the whole story. On a CONFIRM this record is deliberately suppressed:
  // the caller reports the REST outcome via recordOutcome() below, and that terminal
  // 'completed'/'failed' record is the sole audit entry for the confirm (a confirm logs EXACTLY
  // once). Emitting 'allowed' here too would double-log every confirmed mutation.
  if (phase !== 'confirm') {
    emitAuditRecord({
      actor,
      tool,
      action,
      phase,
      target,
      confirmationEvidence: evidenceDescriptor,
      result: 'allowed',
    });
  }

  // Terminal-outcome recorder handed to the caller. Only a confirm phase mutates, so the preview
  // phase is a deliberate no-op — callers can invoke it unconditionally after their REST call. On a
  // confirm this emits the SOLE audit record for the attempt ('completed' or 'failed').
  const recordOutcome = (outcome: { ok: true } | { ok: false; failureDetail?: string }): void => {
    if (phase !== 'confirm') {
      return;
    }
    emitAuditRecord({
      actor,
      tool,
      action,
      phase,
      target,
      confirmationEvidence: evidenceDescriptor,
      result: outcome.ok ? 'completed' : 'failed',
      ...(outcome.ok ? {} : { failureDetail: outcome.failureDetail }),
    });
  };

  return new Ok({ actor, target, recordOutcome });
}

/**
 * Best-effort mapping from a mutation tool to the target `kind` it acts on, used only to label a
 * DENIED audit when target resolution itself failed (so the record still carries a meaningful kind).
 */
function targetKindHint(tool: WebToolName): MutationTarget['kind'] {
  switch (tool) {
    // Defensive default — callers pass fallbackTargetKind which takes precedence; this only fires
    // if that arg is ever dropped from a call site.
    case 'delete-content':
      return 'datasource';
    case 'update-cloud-extract-refresh-task':
      return 'extract-refresh-task';
    case 'update-user':
      return 'user';
    default:
      return 'datasource';
  }
}

/**
 * Validates and emits a single authoritative audit record to the durable log sink. Parsing through
 * the Zod schema guarantees every emitted record carries the required fields (and never the raw
 * nonce). Uses `notice` level on the dedicated `audit` logger so audit records are separable from
 * operational logs. That logger bypasses the LOG_LEVEL severity filter (see AUDIT_LOGGER) so an
 * operator cannot suppress security audit records by raising LOG_LEVEL above `notice`.
 */
function emitAuditRecord(record: Omit<AuditRecord, 'schemaVersion' | 'timestamp'>): void {
  const fullRecord = auditRecordSchema.parse({
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    ...record,
  });
  log({ message: 'mutation-audit', level: 'notice', logger: AUDIT_LOGGER, data: fullRecord });
}
