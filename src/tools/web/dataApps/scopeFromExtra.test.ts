import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';

describe('resolveScopeFromExtra', () => {
  it('prefers the authenticated tableauAuthInfo server/site/user over config defaults', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.server = 'https://config-server.example.com';
    extra.config.transport = 'http';
    extra.sessionId = 'session-1';
    extra.tableauAuthInfo = {
      type: 'Bearer',
      raw: 'jwt',
      username: 'user@example.com',
      server: 'https://auth-server.example.com',
      siteId: 'site-1',
      siteName: 'site',
      userId: 'user-1',
    };

    const result = resolveScopeFromExtra(extra);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      server: 'https://auth-server.example.com',
      siteId: 'site-1',
      actorId: 'user:user-1',
    });
  });

  it('falls back to config.server when tableauAuthInfo has no server', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.server = 'https://config-server.example.com';
    extra.config.transport = 'stdio';
    extra.tableauAuthInfo = undefined;

    const result = resolveScopeFromExtra(extra);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().server).toBe('https://config-server.example.com');
  });

  it('uses the MCP session id to scope an HTTP caller with no authenticated Tableau user', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.server = 'https://config-server.example.com';
    extra.config.transport = 'http';
    extra.sessionId = 'session-42';
    extra.tableauAuthInfo = undefined;

    const result = resolveScopeFromExtra(extra);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().actorId).toBe('session:session-42');
  });

  it('rejects an unscoped multi-user HTTP request with no session and no authenticated user', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.server = 'https://config-server.example.com';
    extra.config.transport = 'http';
    extra.sessionId = undefined;
    extra.tableauAuthInfo = undefined;

    const result = resolveScopeFromExtra(extra);
    expect(result.isErr()).toBe(true);
  });

  it('never derives the actor id from caller-suppliable args (args are not part of the input)', () => {
    // resolveScopeFromExtra takes only `extra`; there is no args parameter it could be tempted to
    // read a scope/actor id from, so this is a structural (type-level) guarantee we assert here.
    expect(resolveScopeFromExtra.length).toBe(1);
  });
});
