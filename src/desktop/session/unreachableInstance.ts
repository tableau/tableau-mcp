/**
 * One message shape for "the Desktop you asked for is not answering".
 *
 * Leaf module on purpose: both `sessionManager` (which owns session creation) and
 * `externalApiToolExecutor` (which owns the wire) need it, and sessionManager already
 * imports the executor.
 *
 * The agent can only re-target if the error names the instance, so every variant names the
 * pid and points at list-instances. Cached XML is called out because a restarted Desktop
 * keeps the same tool-side cache but not the same workbook.
 */

/** A restarted Desktop keeps the tool-side XML cache but not the workbook it was read from. */
export const CACHED_XML_WARNING =
  'Cached XML from the old session may not match the current workbook — re-read before applying.';

export function staleSessionRecoveryMessage(sessionId: string | number): string {
  return (
    `Session ${sessionId} is stale: that Tableau Desktop process is no longer reachable or was restarted. ` +
    `Call list-instances and retry with the current session. ${CACHED_XML_WARNING}`
  );
}

export function noInstanceFoundMessage(pid: string | number): string {
  return `No Desktop instance found with PID ${pid}. ${staleSessionRecoveryMessage(pid)}`;
}

export function unreachableInstanceMessage(pid: string | number, cause?: string): string {
  const base = `Tableau Desktop instance PID ${pid} is not responding. ${staleSessionRecoveryMessage(pid)}`;
  return cause ? `${base} Cause: ${cause}` : base;
}

export function unknownInstanceUnreachableMessage(cause?: string): string {
  const base =
    'Tableau Desktop is not responding and no instance is pinned. ' +
    'Call list-instances to find a running Desktop and retry with that session.';
  return cause ? `${base} Cause: ${cause}` : base;
}
