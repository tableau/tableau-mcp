/**
 * Resolves a stable {@link WorkspaceScope} from server-verified request signals.
 *
 * The scope is the trust boundary for all workspace/validation storage. It must never be derived
 * from a value the tool caller supplies, and a raw PAT/token must never be used as a key. Resolution
 * follows a fixed priority:
 *
 *   1. Authenticated Tableau identity: site id + user id (the strongest, cross-session identity).
 *   2. MCP HTTP session identity: an `mcp-session-id`-backed session id isolates concurrent HTTP
 *      callers that lack a resolved Tableau user (identity is stable for the life of the session).
 *   3. Process-scoped stdio identity: the single-user local server shares one deterministic actor.
 *
 * A multi-user HTTP request with neither an authenticated user nor a session id has no way to be
 * isolated from other users, so persistence is rejected rather than silently shared.
 */

import { Err, Ok, Result } from 'ts-results-es';

import { DataAppWorkspaceAccessDeniedError } from '../errors/mcpToolError.js';
import type { TransportName } from '../transports.js';
import type { WorkspaceScope } from './types.js';

/** The actor id used for the single-user local stdio server. */
export const LOCAL_STDIO_ACTOR_ID = 'local-stdio';

/** The site id stand-in used when a scope has no resolved Tableau site (session/stdio scopes). */
export const UNSCOPED_SITE_ID = 'no-site';

export type WorkspaceScopeInput = {
  transport: TransportName;
  /** The Tableau server origin the caller is bound to. */
  server: string;
  /** Authenticated Tableau site id, when available. */
  siteId?: string;
  /** Authenticated Tableau user id/LUID, when available. */
  userId?: string;
  /** MCP transport session id (`mcp-session-id`), when session management is active. */
  sessionId?: string;
};

/**
 * Resolve a stable workspace scope, or reject when no safe multi-user isolation is possible.
 */
export function resolveWorkspaceScope(
  input: WorkspaceScopeInput,
): Result<WorkspaceScope, DataAppWorkspaceAccessDeniedError> {
  const server = (input.server ?? '').trim();
  if (!server) {
    return new Err(
      new DataAppWorkspaceAccessDeniedError(
        'Cannot resolve a data-app workspace scope without a Tableau server.',
      ),
    );
  }

  // 1. Authenticated Tableau identity (site + user) — the canonical cross-session scope.
  if (input.userId && input.siteId) {
    return new Ok({
      server,
      siteId: input.siteId,
      actorId: `user:${input.userId}`,
    });
  }

  // 3. Single-user local stdio server: one deterministic actor for the whole process. (Checked
  //    before session identity below because stdio and HTTP session ids are mutually exclusive by
  //    transport, so evaluation order between them has no observable effect on priority.)
  if (input.transport === 'stdio') {
    return new Ok({
      server,
      siteId: input.siteId || UNSCOPED_SITE_ID,
      actorId: LOCAL_STDIO_ACTOR_ID,
    });
  }

  // 2. MCP HTTP session identity: the session id isolates this caller even without a Tableau user.
  //    Only reachable on HTTP transport (stdio already returned above).
  if (input.sessionId) {
    return new Ok({
      server,
      siteId: input.siteId || UNSCOPED_SITE_ID,
      actorId: `session:${input.sessionId}`,
    });
  }

  // Multi-user HTTP with no stable actor: refuse to persist rather than share storage across users.
  return new Err(
    new DataAppWorkspaceAccessDeniedError(
      'Cannot resolve a stable actor scope for this request. Data-app workspaces require an ' +
        'authenticated Tableau user or an active MCP session.',
    ),
  );
}
