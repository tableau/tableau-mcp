import { EventEmitter } from 'events';
import { NextFunction, Response } from 'express';
import { Err, Ok } from 'ts-results-es';
import { Mock } from 'vitest';

import { Config } from '../config.js';
import { log } from '../logging/logger.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';
import { getSessionBinding } from './oauth/siteBinding.js';
import { AuthenticatedRequest } from './oauth/types.js';
import { serverEasAuthMiddleware } from './serverEasAuthMiddleware.js';

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), session: vi.fn() }));
const credentials = {
  token: 'opaque-tableau-session',
  user: { id: 'user-id' },
  site: { id: 'site-id' },
};
vi.mock('../sdks/tableau/restApi.js', () => ({
  RestApi: vi.fn().mockImplementation(() => ({
    signIn: mocks.signIn,
    signOut: mocks.signOut,
    sessionCredentials: credentials,
    authenticatedServerMethods: { getCurrentServerSession: mocks.session },
  })),
}));
vi.mock('../logging/logger.js', async (original) => ({
  ...(await original<object>()),
  log: vi.fn(),
}));

function jwt(claims: Record<string, unknown> = {}): string {
  return `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(
    JSON.stringify({
      aud: 'eas-test-client',
      scope: 'openid',
      external_username: 'untrusted-name',
      sub: 'different-subject',
      ...claims,
    }),
  ).toString('base64url')}.signature`;
}

function request(token = jwt()): {
  req: AuthenticatedRequest;
  res: EventEmitter & {
    destroyed: boolean;
    headersSent: boolean;
    status: Mock;
    header: Mock;
    json: Mock;
    end: Mock;
  };
  next: Mock;
  run: () => unknown;
} {
  const req = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
  });
  const next = vi.fn();
  return {
    req,
    res,
    next,
    run: () => serverEasAuthMiddleware()(req, res as unknown as Response, next as NextFunction),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH', 'server-eas');
  vi.stubEnv('TRANSPORT', 'http');
  vi.stubEnv('PAT_NAME', '');
  vi.stubEnv('PAT_VALUE', '');
  vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', 'eas-test-client');
  mocks.signIn.mockResolvedValue(undefined);
  mocks.signOut.mockResolvedValue(undefined);
  mocks.session.mockResolvedValue(
    Ok({
      user: { id: 'user-id', name: 'server-verified-username' },
      site: { id: 'site-id', contentUrl: 'tc25' },
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('uses the unchanged JWT, opaque session and Server identity without inventing scopes', async () => {
  const token = jwt();
  const { req, res, next, run } = request(token);
  await run();
  expect(mocks.signIn).toHaveBeenCalledWith({ type: 'server-eas', siteName: 'tc25', jwt: token });
  expect(next).toHaveBeenCalledOnce();
  expect(req.auth?.token).toBe('server-eas');
  expect(req.auth?.scopes).toEqual([]);
  expect(getTableauAuthInfo(req.auth)).toEqual({
    type: 'ServerEas',
    username: 'server-verified-username',
    userId: 'user-id',
    siteId: 'site-id',
    siteName: 'tc25',
    server: 'https://my-tableau-server.com',
    accessToken: credentials.token,
  });
  expect(mocks.signOut).not.toHaveBeenCalled();
  res.emit('finish');
  res.emit('close');
  await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
});

it.each(['not-a-jwt', jwt({ aud: 'another-client' }), jwt({ aud: [] }), jwt({ aud: 7 })])(
  'rejects invalid recipient input before exchanging credentials',
  async (token) => {
    const { res, next, run } = request(token);
    await run();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  },
);

it('accepts a matching audience array', async () => {
  const { res, next, run } = request(jwt({ aud: ['another-client', 'eas-test-client'] }));
  await run();
  expect(next).toHaveBeenCalledOnce();
  res.emit('finish');
});

it.each(['x-tableau-auth', 'cookie'])(
  'rejects mixed %s credentials before sign-in',
  async (header) => {
    const { req, res, run } = request();
    req.headers[header] = header === 'cookie' ? 'workgroup_session_id=synthetic' : 'synthetic';
    await run();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.signIn).not.toHaveBeenCalled();
  },
);

it('rejects previously populated auth instead of skipping its policy', async () => {
  const { req, res, run } = request();
  req.auth = { token: 'other', clientId: 'other', scopes: [] };
  await run();
  expect(res.status).toHaveBeenCalledWith(400);
  expect(mocks.signIn).not.toHaveBeenCalled();
});

it('challenges a missing bearer without exchanging a credential', async () => {
  const { req, res, run } = request();
  delete req.headers.authorization;
  await run();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.header).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer realm="MCP"');
});

it.each([
  { user: { id: 'other-user', name: 'name' }, site: { id: 'site-id', contentUrl: 'tc25' } },
  { user: { id: 'user-id', name: 'name' }, site: { id: 'other-site', contentUrl: 'tc25' } },
  { user: { id: 'user-id', name: 'name' }, site: { id: 'site-id', contentUrl: 'another-site' } },
])('cleans up a Server session that fails identity/site binding', async (session) => {
  mocks.session.mockResolvedValue(Ok(session));
  const { res, next, run } = request();
  await run();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
  expect(mocks.signOut).toHaveBeenCalledOnce();
});

it('cleans up failed canonical identity lookup', async () => {
  mocks.session.mockResolvedValue(Err(new Error('private response')));
  const { res, run } = request();
  await run();
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(res.json).toHaveBeenCalledWith({
    error: 'invalid_token',
    error_description: 'Authentication failed',
  });
  expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain('private response');
});

it('cleans up a sign-in that finishes after disconnect', async () => {
  let complete!: () => void;
  mocks.signIn.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const { res, next, run } = request();
  const pending = run();
  res.emit('close');
  complete();
  await pending;
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(next).not.toHaveBeenCalled();
});

it('cleans up disconnect during canonical identity lookup', async () => {
  let complete!: (value: unknown) => void;
  mocks.session.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { res, next, run } = request();
  const pending = run();
  await vi.waitFor(() => expect(mocks.session).toHaveBeenCalledOnce());
  res.emit('close');
  complete(
    Ok({ user: { id: 'user-id', name: 'name' }, site: { id: 'site-id', contentUrl: 'tc25' } }),
  );
  await pending;
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(next).not.toHaveBeenCalled();
});

it('does not retry an unknown upstream outcome or expose private error data', async () => {
  mocks.signIn.mockRejectedValue({
    isAxiosError: true,
    config: { data: jwt() },
    message: 'private failure',
  });
  const { res, next, run } = request();
  await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
  expect(mocks.signIn).toHaveBeenCalledOnce();
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(JSON.stringify([res.json.mock.calls, vi.mocked(log).mock.calls])).not.toContain(
    'private failure',
  );
});

it('preserves a rejection when signout also fails', async () => {
  mocks.session.mockResolvedValue(Err(new Error('identity lookup failed')));
  mocks.signOut.mockRejectedValue(new Error('private cleanup error'));
  const { res, run } = request();
  await run();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain('private cleanup error');
});

it('bounds a long-lived response by the authenticated token expiry', async () => {
  vi.useFakeTimers();
  const { res, run } = request(jwt({ exp: Math.floor(Date.now() / 1000) + 5 }));
  await run();
  await vi.advanceTimersByTimeAsync(5000);
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(res.end).toHaveBeenCalledOnce();
});

it('binds MCP sessions to stable Server identity, independently of changing session credentials', async () => {
  const { req, res, run } = request();
  await run();
  const info = getTableauAuthInfo(req.auth)!;
  if (info.type !== 'ServerEas') throw new Error('Expected EAS identity');
  expect(getSessionBinding(info)).toBe(getSessionBinding({ ...info, accessToken: 'new-session' }));
  expect(getSessionBinding(info)).not.toBe(getSessionBinding({ ...info, userId: 'other-user' }));
  res.emit('finish');
});

describe('configuration', () => {
  it('defaults to HTTP without enabling an OAuth provider or passthrough', () => {
    vi.stubEnv('TRANSPORT', '');
    const config = new Config();
    expect(config.transport).toBe('http');
    expect(config.oauth.enabled).toBe(false);
    expect(config.enablePassthroughAuth).toBe(false);
  });
  it.each([
    ['TRANSPORT', 'stdio'],
    ['ENABLE_PASSTHROUGH_AUTH', 'true'],
    ['OAUTH_ISSUER', 'https://issuer.example.com'],
    ['CONNECTED_APP_CLIENT_ID', 'synthetic-client'],
    ['PAT_VALUE', 'synthetic-pat'],
    ['SERVER', 'http://remote.example.com'],
  ])('rejects incompatible %s configuration', (key, value) => {
    vi.stubEnv(key, value);
    expect(() => new Config()).toThrow();
  });
});

it('classifies an unavailable canonical identity lookup without exposing its response', async () => {
  mocks.session.mockResolvedValue(Err({ type: 'unknown', message: 'private upstream response' }));
  const { res, run } = request();
  await run();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(mocks.signOut).toHaveBeenCalledOnce();
  expect(JSON.stringify([res.json.mock.calls, vi.mocked(log).mock.calls])).not.toContain(
    'private upstream response',
  );
});

it('accepts the Default site when current-session omits its empty content URL', async () => {
  vi.stubEnv('SITE_NAME', '');
  mocks.session.mockResolvedValue(
    Ok({ user: { id: 'user-id', name: 'viewer' }, site: { id: 'site-id', name: 'Default' } }),
  );
  const { req, res, next, run } = request();
  await run();
  expect(next).toHaveBeenCalledOnce();
  expect(getTableauAuthInfo(req.auth)?.siteName).toBe('');
  res.emit('finish');
});

it('still requires authentication when OAuth disable switches are set', async () => {
  vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
  vi.stubEnv('OAUTH_DISABLE_SCOPES', 'true');
  const { req, res, run } = request();
  delete req.headers.authorization;
  await run();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mocks.signIn).not.toHaveBeenCalled();
});

it('preserves a Server credential rejection without creating or retrying a session', async () => {
  mocks.signIn.mockRejectedValue({
    isAxiosError: true,
    response: { status: 401, data: 'private rejection' },
  });
  const { res, run } = request();
  await run();
  expect(res.status).toHaveBeenCalledWith(401);
  expect(mocks.signIn).toHaveBeenCalledOnce();
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private rejection');
});
