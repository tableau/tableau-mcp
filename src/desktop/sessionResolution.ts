import { Err, Ok, Result } from 'ts-results-es';

import { getDesktopConfig } from '../config.desktop.js';
import {
  ArgsValidationError,
  McpToolError,
  NoDesktopInstancesFoundError,
} from '../errors/mcpToolError.js';
import { DesktopDiscoverer } from './desktopDiscoverer.js';
import { discoverInstances } from './externalApi/discovery.js';

/**
 * Resolve which Tableau Desktop session (pid) a session-scoped tool should target.
 *
 * Precedence:
 *   1. Explicit `session` arg — the caller always wins.
 *   2. `config.desktopSessionId` — the launching Desktop pinned itself via
 *      `TABLEAU_DESKTOP_SESSION_ID`, so the agent never needs list-instances.
 *   3. Auto-resolve when exactly one Desktop instance is running. 0 or 2+ instances
 *      fail closed with an instance-listing error rather than guessing.
 *
 * Transport-aware: the External Client API and the legacy Agent API discover instances
 * differently, so step 3 reads whichever the active transport uses.
 */
export function resolveSession(session: string | undefined): Result<string, McpToolError> {
  if (session !== undefined) {
    return Ok(session);
  }

  const config = getDesktopConfig();
  if (config.desktopSessionId !== undefined) {
    return Ok(config.desktopSessionId);
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
        `Multiple Tableau Desktop instances are running (session IDs: ${pids.join(', ')}). Specify which one to use via the 'session' parameter (see list-instances for details).`,
      ),
    );
  }

  return Ok(String(pids[0]));
}
