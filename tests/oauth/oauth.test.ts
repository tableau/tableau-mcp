import express from 'express';
import http from 'http';
import request from 'supertest';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { AwaitableWritableStream } from './awaitableWriteableStream.js';
import { exchangeAuthzCodeForAccessToken } from './exchangeAuthzCodeForAccessToken.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
  mockGetCurrentServerSession: vi.fn(),
}));

vi.mock('../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

vi.mock('../../src/sdks/tableau/restApi.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    setCredentials: vi.fn().mockResolvedValue(undefined),
    serverMethods: {
      getCurrentServerSession: mocks.mockGetCurrentServerSession,
    },
  })),
}));

describe('OAuth', () => {
  let _server: http.Server | undefined;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(() => {
    vi.clearAllMocks();
    _server = undefined;
  });

  afterEach(async () => {
    return new Promise<void>((resolve) => {
      _server?.close(() => {
        resolve();
      });
    });
  });

  async function startServer(): Promise<{ app: express.Application }> {
    const { app, server } = await startExpressServer({
      basePath: serverName,
      config: getConfig(),
      logLevel: 'info',
    });

    _server = server;
    return { app };
  }

  it('should return 401 for unauthenticated requests', async () => {
    const { app } = await startServer();

    const response = await request(app).post(`/${serverName}`);
    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['www-authenticate']).toMatch(
      /Bearer realm="MCP", resource_metadata="http:\/\/127\.0\.0\.1:(\d+)\/.well-known\/oauth-protected-resource"/,
    );
    expect(response.body).toEqual({
      error: 'unauthorized',
      error_description: 'Authorization required. Use OAuth 2.1 flow.',
    });
  });

  it('should provide a protected resource metadata endpoint for the OAuth 2.1 flow', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/.well-known/oauth-protected-resource');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      resource: `http://127.0.0.1:3927/${serverName}`,
      authorization_servers: ['http://127.0.0.1:3927'],
      bearer_methods_supported: ['header'],
    });
  });

  it('should provide a authorization server metadata endpoint for the OAuth 2.1 flow', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      issuer: 'http://127.0.0.1:3927',
      authorization_endpoint: 'http://127.0.0.1:3927/oauth/authorize',
      token_endpoint: 'http://127.0.0.1:3927/oauth/token',
      registration_endpoint: 'http://127.0.0.1:3927/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:tools:tableau:read'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      subject_types_supported: ['public'],
    });
  });

  it('should allow authenticated requests', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    mocks.mockGetCurrentServerSession.mockResolvedValue(
      Ok({
        site: {
          id: 'site_id',
          name: 'test-site',
        },
        user: {
          id: 'user_id',
          name: 'test-user',
        },
      }),
    );

    const { access_token } = await exchangeAuthzCodeForAccessToken(app);

    const awaitableWritableStream = new AwaitableWritableStream();

    request(app)
      .post(`/${serverName}`)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'ping',
      })
      .pipe(awaitableWritableStream.stream);

    const messages = await awaitableWritableStream.getChunks((chunk) =>
      Buffer.from(chunk).toString('utf-8'),
    );

    expect(messages).toHaveLength(1);
    const message = messages[0];
    const lines = message.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('event: message');
    const data = JSON.parse(lines[1].split('data: ')[1]);
    expect(data).toEqual({ result: {}, jsonrpc: '2.0', id: '1' });
  });
});
