import { DataAppWorkspaceAccessDeniedError } from '../errors/mcpToolError.js';
import type { WorkspaceScope } from './types.js';
import {
  LOCAL_STDIO_ACTOR_ID,
  resolveWorkspaceScope,
  UNSCOPED_SITE_ID,
  WorkspaceScopeInput,
} from './workspaceScope.js';

const server = 'https://tableau.example.com';

function resolveOk(input: WorkspaceScopeInput): WorkspaceScope {
  const result = resolveWorkspaceScope(input);
  expect(result.isOk()).toBe(true);
  return result.unwrap();
}

describe('resolveWorkspaceScope', () => {
  it('prefers authenticated Tableau site + user identity', () => {
    const scope = resolveOk({
      transport: 'http',
      server,
      siteId: 'site-1',
      userId: 'user-1',
      sessionId: 'session-abc',
    });

    expect(scope).toEqual({
      server,
      siteId: 'site-1',
      actorId: 'user:user-1',
    });
  });

  it('falls back to the local stdio actor for a single-user process', () => {
    const scope = resolveOk({ transport: 'stdio', server });

    expect(scope).toEqual({
      server,
      siteId: UNSCOPED_SITE_ID,
      actorId: LOCAL_STDIO_ACTOR_ID,
    });
  });

  it('keeps an authenticated site id even for the stdio actor', () => {
    const scope = resolveOk({ transport: 'stdio', server, siteId: 'site-9' });
    expect(scope.siteId).toBe('site-9');
    expect(scope.actorId).toBe(LOCAL_STDIO_ACTOR_ID);
  });

  it('uses the MCP session id to isolate HTTP callers without a Tableau user', () => {
    const scope = resolveOk({ transport: 'http', server, sessionId: 'session-xyz' });

    expect(scope).toEqual({
      server,
      siteId: UNSCOPED_SITE_ID,
      actorId: 'session:session-xyz',
    });
  });

  it('gives different HTTP sessions different actor scopes', () => {
    const a = resolveOk({ transport: 'http', server, sessionId: 'session-a' });
    const b = resolveOk({ transport: 'http', server, sessionId: 'session-b' });
    expect(a.actorId).not.toBe(b.actorId);
  });

  it('rejects a multi-user HTTP request with no user and no session', () => {
    const result = resolveWorkspaceScope({ transport: 'http', server });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DataAppWorkspaceAccessDeniedError);
  });

  it('rejects when no server is present', () => {
    const result = resolveWorkspaceScope({ transport: 'stdio', server: '' });
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBeInstanceOf(DataAppWorkspaceAccessDeniedError);
  });

  it('never derives the actor id from a caller-suppliable value alone', () => {
    // A user id present without a site id must not be trusted as a full scope on HTTP; it falls
    // through to session/rejection rather than fabricating a site.
    const result = resolveWorkspaceScope({ transport: 'http', server, userId: 'user-1' });
    expect(result.isErr()).toBe(true);
  });
});
