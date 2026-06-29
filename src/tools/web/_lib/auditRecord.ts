import { z } from 'zod';

/**
 * Authoritative audit record for a mutation attempt (allowed or denied) on any in-scope TMCP
 * mutation tool. Emitted by the shared mutation guard exactly once per attempt to a durable log
 * sink — not just the tool-response text the model reads back — so the record survives regardless
 * of what the model does with the response.
 *
 * `schemaVersion` is a literal so downstream consumers can branch on the shape if it ever changes.
 *
 * SECURITY: `confirmationEvidence.detail` is a non-sensitive description of the evidence (e.g. the
 * tag label, or that a registry nonce matched) — it MUST NEVER carry the raw single-use nonce, which
 * would let a reader of the audit log forge a confirmation.
 */
export const auditRecordSchema = z.object({
  schemaVersion: z.literal(1),
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
    kind: z.enum(['datasource', 'workbook', 'extract-refresh-task', 'user']),
  }),
  confirmationEvidence: z.object({
    kind: z.enum(['tag', 'registry-nonce', 'none']),
    // Non-sensitive description only — NEVER the raw nonce.
    detail: z.string().optional(),
  }),
  result: z.enum(['allowed', 'denied']),
  denyReason: z.string().optional(),
});

export type AuditRecord = z.infer<typeof auditRecordSchema>;
