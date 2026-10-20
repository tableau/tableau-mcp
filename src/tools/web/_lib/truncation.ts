/**
 * Why a tool result was cut short. Only set when `truncated` is `true`.
 *
 * - `'requested-limit'` — the caller's own `limit` argument bound the result.
 *   More results match; calling again with a higher `limit` (or omitting it)
 *   returns more.
 * - `'admin-cap'` — the operator-configured `MAX_RESULT_LIMIT` (or
 *   `MAX_RESULT_LIMITS=<tool>:N`) bound the result, AND the caller did not
 *   ask for an equal-or-smaller `limit` itself. The `limit` argument cannot
 *   exceed this cap, so the matching set must be narrowed (filter) or the cap
 *   raised by an administrator.
 *   On paged tools it means the cap hides items from the whole set, whatever the page or `limit`.
 */
export type TruncationReason = 'requested-limit' | 'admin-cap';

/**
 * Classify whether (and why) the tool returned fewer results than match the
 * request. Drives `mcp.resultInfo.truncated` / `truncationReason`.
 *
 *  - Not truncated (`truncatedByLimit === false`) → `{ truncated: false }`.
 *  - Truncated by the operator cap → `'admin-cap'`, but ONLY when the cap was
 *    the binding constraint AND the caller did not request an equal-or-smaller
 *    `limit` itself. If the caller asked for `limit: 10` while the cap is 100,
 *    the truncation was the caller's intent, so it is reported as
 *    `'requested-limit'`, not `'admin-cap'`.
 *  - Otherwise (the caller's own `limit` was binding, or there is no cap) →
 *    `'requested-limit'`.
 */
export function buildTruncationInfo({
  truncatedByLimit,
  maxResultLimit,
  llmLimit,
  effectiveLimit,
}: {
  truncatedByLimit: boolean;
  maxResultLimit: number | null;
  llmLimit: number | undefined;
  effectiveLimit: number | undefined;
}): { truncated: boolean; truncationReason?: TruncationReason } {
  if (!truncatedByLimit) {
    return { truncated: false };
  }

  const adminCapWasBinding =
    maxResultLimit !== null &&
    effectiveLimit === maxResultLimit &&
    (llmLimit === undefined || llmLimit > maxResultLimit);

  return {
    truncated: true,
    truncationReason: adminCapWasBinding ? 'admin-cap' : 'requested-limit',
  };
}
