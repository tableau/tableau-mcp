/**
 * Parse a desktop session id — an OS pid rendered as a decimal string — into a
 * number. Returns undefined for anything that is not a plain run of digits.
 */
export function parseSessionPid(sessionId: string): number | undefined {
  if (!/^\d+$/.test(sessionId)) {
    return undefined;
  }

  const pid = Number.parseInt(sessionId, 10);
  return Number.isNaN(pid) ? undefined : pid;
}
