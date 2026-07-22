import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../config.desktop.js';
import {
  ArgsValidationError,
  McpToolError,
  NoDesktopInstancesFoundError,
} from '../errors/mcpToolError.js';
import { DesktopToolName } from '../tools/desktop/toolName.js';
import { discoverInstances } from './externalApi/discovery.js';

const LIST_INSTANCES_TOOL: DesktopToolName = 'list-instances';

/**
 * Resolve which Tableau Desktop session (pid) a session-scoped tool should target.
 *
 * The pin (`config.desktopSessionId`, set when the launching Desktop passes
 * `TABLEAU_DESKTOP_SESSION_ID`) is a DEFAULT, not an invariant: it is used when no
 * `session` is given, but the caller may still target another running Desktop by passing
 * its pid explicitly.
 *
 * Precedence:
 *   1. No explicit `session` (or the sentinel "default") — use the pin if set, else
 *      auto-resolve when exactly one Desktop is running (0 or 2+ fail closed).
 *   2. Explicit `session` equal to the pin — use the pin (no discovery needed).
 *   3. Explicit `session` naming another Desktop — honored if that pid is a running
 *      instance. Rejected only when discovery lists other running instances that exclude
 *      it; if discovery is empty we cannot confirm, so we proceed and let the executor's
 *      unreachable handling report a truly dead pid (never block blind — same posture as
 *      the cache-fingerprint guard).
 *
 * Uses the External Client API discovery files written by Tableau Desktop.
 */
export function resolveSession(session: string | undefined): Result<string, McpToolError> {
  // Treat empty/whitespace AND the sentinel "default" as ABSENT. Some clients inject
  // session:"default" as a placeholder; that literal is never a real pid, so it means
  // "use whatever session is resolved" (the pin, or the sole running instance).
  const trimmed = session?.trim();
  const requestedSession = trimmed && trimmed.toLowerCase() !== 'default' ? trimmed : undefined;
  const config = getDesktopConfig();

  if (requestedSession === undefined || requestedSession === config.desktopSessionId) {
    if (config.desktopSessionId !== undefined) {
      return Ok(config.desktopSessionId);
    }

    const pids = discoverInstances({ discoveryDir: config.externalApiDiscoveryDir }).map(
      (i) => i.pid,
    );

    if (pids.length === 0) {
      return Err(new NoDesktopInstancesFoundError());
    }
    if (pids.length > 1) {
      return Err(
        new ArgsValidationError(
          `Multiple Tableau Desktop instances are running (session IDs: ${pids.join(', ')}). Specify which one to use via the 'session' parameter (see ${LIST_INSTANCES_TOOL} for details).`,
        ),
      );
    }

    return Ok(String(pids[0]));
  }

  const runningPids = discoverInstances({ discoveryDir: config.externalApiDiscoveryDir }).map((i) =>
    String(i.pid),
  );
  if (runningPids.length > 0 && !runningPids.includes(requestedSession)) {
    return Err(
      new ArgsValidationError(
        `Tableau Desktop session '${requestedSession}' is not a running instance (running: ${runningPids.join(', ')}). See ${LIST_INSTANCES_TOOL} for the current instances.`,
      ),
    );
  }

  return Ok(requestedSession);
}
