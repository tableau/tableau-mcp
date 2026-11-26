/**
 * Redacts secret-bearing tool arguments before they reach a log line or an MCP logging notification.
 *
 * HITL confirmation / approval tokens are bearer-style proof that a preview ran: anyone who reads
 * one from a debug log could replay it within its TTL. Tools used to redact them one call site at a
 * time; this is the single, generic choke point applied by Tool.notifyInvocation and
 * WebTool.logAndExecute, so a new tool that forgets cannot leak one.
 *
 * Matching is by EXACT key name from an explicit list (REDACTED_ARG_KEYS), case-insensitively, at any
 * depth. Values are replaced with REDACTED_VALUE; the input is never mutated. Non-plain values pass
 * through as is.
 *
 * An explicit list, not a suffix rule: a generic "ends in token" match would also redact pagination
 * cursors (`pageToken`, `nextPageToken`) and similar non-secret args, hiding exactly what a debug
 * log is for. The token-named secret args the tools actually accept are `confirmationToken` and
 * `approvalToken`; add a new secret-bearing arg name here when a tool introduces one.
 */
export const REDACTED_VALUE = '<redacted>';

// Lower-case; compared against key.toLowerCase().
const REDACTED_ARG_KEYS: ReadonlySet<string> = new Set([
  'confirmationtoken',
  'approvaltoken',
  'token',
  'secret',
  'password',
  'accesstoken',
  'refreshtoken',
]);
const MAX_DEPTH = 8;

function isSecretKey(key: string): boolean {
  return REDACTED_ARG_KEYS.has(key.toLowerCase());
}

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] =
      isSecretKey(key) && entry !== undefined && entry !== null && entry !== ''
        ? REDACTED_VALUE
        : redact(entry, depth + 1);
  }
  return out;
}

/** Returns a copy of `args` with every secret-bearing value replaced by REDACTED_VALUE. */
export function redactSecretArgs<T>(args: T): T {
  return redact(args, 0) as T;
}
