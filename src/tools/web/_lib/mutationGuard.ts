/**
 * Common mutation-tool safety layer for the TMCP server (W-23125362).
 *
 * Every in-scope mutation tool (delete-datasource, delete-workbook, delete-extract-refresh-task,
 * update-cloud-extract-refresh-task) routes its mutation through `guardMutation` instead of
 * re-implementing its own admin check, identity resolution, confirmation gate, and audit. The guard:
 *
 *   1. Enforces the admin gate (assertAdmin) uniformly.
 *   2. Resolves the actor identity and the mutation target.
 *   3. For preview→confirm tools, runs the pluggable EvidenceStrategy: `establish` proof in the
 *      preview phase, and on confirm `verify` it against live server state — rejecting precomputed or
 *      forged confirmations exactly as #414's tag gate does.
 *   4. Emits a single authoritative AuditRecord (allowed OR denied) to the durable log sink.
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
  // 'user' is reserved/forward-looking: no user-mutation tool is wired yet. Kept in the union so the
  // audit schema (auditRecord.ts) stays stable when one is added; removing it now would be a
  // breaking schema change for downstream audit-log consumers.
  kind: 'datasource' | 'workbook' | 'extract-refresh-task' | 'user';
}

/** What the guard hands back to the tool on success so it can build its tool-specific response. */
export interface GuardOutcome {
  actor: MutationActor;
  target: MutationTarget;
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
    const deniedTarget = await resolveTarget();
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
      return new PreviewNotRunError(
        `Mutation blocked: ${tool} could not verify that a preview ran for ${target.kind} ` +
          `${target.id}. Run ${tool} with confirm omitted (or false) first to preview, then call ` +
          'again with confirm: true. This gate verifies server-side state and cannot be bypassed by ' +
          'computing a token.',
      ).toErr();
    }
  }

  // (5) Preview phase: establish the server-side proof the confirm phase will verify.
  if (phase === 'preview') {
    await evidence.establish(evidenceCtx);
  }

  // (6) Allowed: record the attempt and let the tool perform its mutation / build its response.
  emitAuditRecord({
    actor,
    tool,
    action,
    phase,
    target,
    confirmationEvidence: evidenceDescriptor,
    result: 'allowed',
  });
  return new Ok({ actor, target });
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
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...record,
  });
  log({ message: 'mutation-audit', level: 'notice', logger: AUDIT_LOGGER, data: fullRecord });
}
