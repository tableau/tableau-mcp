import { z } from 'zod';

/**
 * Authoritative audit record for a mutation attempt (allowed or denied) on any in-scope TMCP
 * mutation tool. Emitted by the shared mutation guard exactly once per attempt to a durable log
 * sink — not just the tool-response text the model reads back — so the record survives regardless
 * of what the model does with the response.
 *
 * `schemaVersion` is a literal so downstream consumers can branch on the shape if it ever changes.
 * Bumped to 2 when the `result` enum was widened from `allowed|denied` to
 * `allowed|denied|completed|failed` (terminal-outcome records): a consumer pinned to the v1 strict
 * enum would zod-fail on a `completed`/`failed` record, so the version bump signals that parsers
 * must be updated rather than silently dropping the outcome data.
 *
 * SECURITY: `confirmationEvidence.detail` is a non-sensitive description of the evidence (e.g. the
 * tag label, or that a registry nonce matched) — it MUST NEVER carry the raw single-use nonce, which
 * would let a reader of the audit log forge a confirmation.
 */
export const auditRecordSchema = z.object({
  schemaVersion: z.literal(2),
  timestamp: z.string().datetime(),
  actor: z.object({
    username: z.string().optional(),
    userLuid: z.string().optional(),
    siteLuid: z.string(),
    siteName: z.string(),
  }),
  // The WebToolName of the tool that attempted the mutation.
  tool: z.string(),
  action: z.enum(['delete', 'update']),
  phase: z.enum(['preview', 'confirm']),
  target: z.object({
    id: z.string(),
    name: z.string().optional(),
    project: z.string().optional(),
    owner: z.string().optional(),
    // 'user' is reserved/forward-looking — no user-mutation tool emits it yet. Retained so this
    // audit schema stays stable (and version 1 valid) when one is added; dropping it would be a
    // breaking change for audit-log consumers parsing this enum.
    kind: z.enum(['datasource', 'workbook', 'extract-refresh-task', 'user']),
  }),
  confirmationEvidence: z.object({
    kind: z.enum(['tag', 'registry-nonce', 'none']),
    // Non-sensitive description only — NEVER the raw nonce.
    detail: z.string().optional(),
  }),
  // Lifecycle of a mutation attempt:
  //   - 'denied'    — authorization/evidence gate rejected the attempt; nothing mutated.
  //   - 'allowed'   — the attempt passed the gate. For a preview this is terminal (nothing mutates);
  //                   for a confirm it records only the AUTHORIZATION decision and is followed by a
  //                   terminal outcome record once the destructive REST call returns.
  //   - 'completed' — the confirmed mutation's REST call succeeded.
  //   - 'failed'    — the confirmed mutation was authorized but its REST call failed; the target is
  //                   unchanged. Distinguishing this from 'completed' is what an incident responder
  //                   needs — an 'allowed' record alone cannot tell authorized-but-failed from done.
  result: z.enum(['allowed', 'denied', 'completed', 'failed']),
  denyReason: z.string().optional(),
  // Non-sensitive summary of why a 'failed' outcome failed (e.g. the Tableau status/code). Never set
  // for other results.
  failureDetail: z.string().optional(),
});

export type AuditRecord = z.infer<typeof auditRecordSchema>;
