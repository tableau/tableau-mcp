import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../config.desktop.js';
import {
  ArgsValidationError,
  McpToolError,
  NoDesktopInstancesFoundError,
} from '../errors/mcpToolError.js';
import { DesktopToolName } from '../tools/desktop/toolName.js';
import { DesktopDiscoverer } from './desktopDiscoverer.js';
import { discoverInstances } from './externalApi/discovery.js';

const LIST_INSTANCES_TOOL: DesktopToolName = 'list-instances';

/**
 * Resolve which Tableau Desktop session (pid) a session-scoped tool should target.
 *
 * Precedence:
 *   1. `config.desktopSessionId` — when the launching Desktop pinned itself via
 *      `TABLEAU_DESKTOP_SESSION_ID`, the pin is an invariant: it always wins, and an
 *      explicit `session` naming a different Desktop is rejected rather than honored.
 *      (list-instances is hidden when pinned, so any conflicting explicit session can
 *      only be stale model context.)
 *   2. Explicit `session` arg — when unpinned, the caller chooses.
 *   3. Auto-resolve when exactly one Desktop instance is running. 0 or 2+ instances
 *      fail closed with an instance-listing error rather than guessing.
 *
 * Transport-aware: the External Client API and the legacy Agent API discover instances
 * differently, so step 3 reads whichever the active transport uses.
 */
export function resolveSession(session: string | undefined): Result<string, McpToolError> {
  const requestedSession = session?.trim() ? session : undefined;
  const config = getDesktopConfig();
  if (config.desktopSessionId !== undefined) {
    if (requestedSession !== undefined && requestedSession !== config.desktopSessionId) {
      return Err(
        new ArgsValidationError(
          `This agent is pinned to Tableau Desktop (pid ${config.desktopSessionId}), but session '${requestedSession}' was requested. Omit the 'session' parameter — the pinned Desktop is used automatically.`,
        ),
      );
    }
    return Ok(config.desktopSessionId);
  }

  if (requestedSession !== undefined) {
    return Ok(requestedSession);
  }

  const pids = config.externalApiEnabled
    ? discoverInstances({ discoveryDir: config.externalApiDiscoveryDir }).map((i) => i.pid)
    : Array.from(new DesktopDiscoverer().getInstances().values()).map((i) => i.pid);

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
