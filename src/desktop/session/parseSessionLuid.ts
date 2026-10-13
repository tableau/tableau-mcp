/**
 * Parse a desktop session LUID — a GUID string that identifies the launching Tableau Desktop
 * session, the stable counterpart to the OS pid parsed by parseSessionPid. Returns the GUID
 * unchanged when it is a well-formed UUID, else undefined.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSessionLuid(sessionLuid: string): string | undefined {
  const trimmed = sessionLuid.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : undefined;
}
