/**
 * Messages for "the agent can't reach Desktop".
 *
 * Leaf module on purpose: both `sessionManager` (which owns session creation) and
 * `externalApiToolExecutor` (which owns the wire) need it, and sessionManager already
 * imports the executor.
 *
 * Two kinds of message live here:
 * - Retarget messages (stale session, unreachable pid) name the pid and point at
 *   list-instances, because the agent can only re-target if the error names the instance.
 *   Cached XML is called out because a restarted Desktop keeps the tool-side cache but not
 *   the workbook.
 * - Access-off messages (External API access turned off) tell the user how to turn it on.
 *   The pinned one omits list-instances on purpose: relaunching is the only safe reconnect
 *   (see `sessionManager.ts`).
 */

import { EXTERNAL_API_ACCESS_HOW_TO_FIX } from '../../errors/externalApiAccess.js';

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

export function externalApiDisabledMessage(): string {
  return `External API access is turned off in Tableau Studio, so I can't connect to your workbook. ${EXTERNAL_API_ACCESS_HOW_TO_FIX}`;
}

export function pinnedDesktopNotAcceptingMessage(pid: string | number): string {
  return (
    `A process with PID ${pid} is still running but isn't accepting agent connections. ` +
    `If it is Tableau Desktop and has finished starting, External API access is probably turned off. ${EXTERNAL_API_ACCESS_HOW_TO_FIX} ` +
    'Then relaunch the agent from Tableau Desktop to reconnect.'
  );
}

export const UNPINNED_NO_INSTANCE_HINT = `If Tableau Desktop is open, External API access may be turned off. ${EXTERNAL_API_ACCESS_HOW_TO_FIX}`;
