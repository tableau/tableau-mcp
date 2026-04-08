import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../../src/config.js';
import { serverName } from '../../../src/server.js';
import { startExpressServer } from '../../../src/server/express.js';
import { generateCodeChallenge } from '../../../src/server/oauth/generateCodeChallenge.js';
import * as getTableauAuthInfoModule from '../../../src/server/oauth/getTableauAuthInfo.js';
import {
  PassthroughAuthInfo,
  passthroughAuthInfoSchema,
} from '../../../src/server/passthroughAuthMiddleware.js';
import { AwaitableWritableStream } from './awaitableWritableStream.js';
import { exchangeAuthzCodeForAccessToken } from './exchangeAuthzCodeForAccessToken.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

describe('OAuth', () => {
  let _server: http.Server | undefined;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    _server = undefined;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (_server) {
        _server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
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

  it('should use OAUTH_RESOURCE_URI in 401 resource_metadata when set', async () => {
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');

    const { app } = await startServer();

    const response = await request(app).post(`/${serverName}`);
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it('should strip path from OAUTH_RESOURCE_URI in 401 resource_metadata', async () => {
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com/tableau-mcp');

    const { app } = await startServer();

    const response = await request(app).post(`/${serverName}`);
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
    );
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
      scopes_supported: [
        'tableau:mcp:datasource:read',
        'tableau:mcp:workbook:read',
        'tableau:mcp:view:read',
        'tableau:mcp:view:download',
        'tableau:mcp:pulse:read',
        'tableau:mcp:insight:create',
        'tableau:mcp:content:read',
      ],
    });
  });

  it('should provide a authorization server metadata endpoint for the OAuth 2.1 flow', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      issuer: 'http://127.0.0.1:3927',
      authorization_endpoint: 'http://127.0.0.1:3927/oauth2/authorize',
      token_endpoint: 'http://127.0.0.1:3927/oauth2/token',
      registration_endpoint: 'http://127.0.0.1:3927/oauth2/register',
      revocation_endpoint: 'http://127.0.0.1:3927/oauth2/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [
        'tableau:mcp:datasource:read',
        'tableau:mcp:workbook:read',
        'tableau:mcp:view:read',
        'tableau:mcp:view:download',
        'tableau:mcp:pulse:read',
        'tableau:mcp:insight:create',
        'tableau:mcp:content:read',
      ],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      subject_types_supported: ['public'],
      client_id_metadata_document_supported: true,
    });
  });

  it('should provide a authorization server metadata endpoint for the OAuth 2.1 flow without client credentials', async () => {
    vi.stubEnv('OAUTH_CLIENT_ID_SECRET_PAIRS', '');

    const { app } = await startServer();

    const response = await request(app).get('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      issuer: 'http://127.0.0.1:3927',
      authorization_endpoint: 'http://127.0.0.1:3927/oauth2/authorize',
      token_endpoint: 'http://127.0.0.1:3927/oauth2/token',
      registration_endpoint: 'http://127.0.0.1:3927/oauth2/register',
      revocation_endpoint: 'http://127.0.0.1:3927/oauth2/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [
        'tableau:mcp:datasource:read',
        'tableau:mcp:workbook:read',
        'tableau:mcp:view:read',
        'tableau:mcp:view:download',
        'tableau:mcp:pulse:read',
        'tableau:mcp:insight:create',
        'tableau:mcp:content:read',
      ],
      token_endpoint_auth_methods_supported: ['none'],
      subject_types_supported: ['public'],
      client_id_metadata_document_supported: true,
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

    const { access_token } = await exchangeAuthzCodeForAccessToken(app);

    const awaitableWritableStream = new AwaitableWritableStream();

    const response = await request(app)
      .post(`/${serverName}`)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {
            elicitation: {},
          },
          clientInfo: {
            name: 'tableau-mcp-tests',
            version: '1.0.0',
          },
        },
        jsonrpc: '2.0',
        id: 0,
      })
      .expect(200);

    const sessionId = response.headers['mcp-session-id'];

    request(app)
      .post(`/${serverName}`)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
      })
      .pipe(awaitableWritableStream.stream);

    const messages = await awaitableWritableStream.getChunks((chunk) =>
      Buffer.from(chunk).toString('utf-8'),
    );

    expect(messages.length).toBeGreaterThan(0);
    const message = messages.join('');
    const lines = message.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe('event: message');
    const data = JSON.parse(lines[1].substring(lines[1].indexOf('data: ') + 6));
    expect(data).toMatchObject({ result: { tools: expect.any(Array) } });
  });

  it('should allow authenticated requests using the X-Tableau-Auth header', async () => {
    vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');

    const { app } = await startServer();

    const awaitableWritableStream = new AwaitableWritableStream();

    const response = await request(app)
      .post(`/${serverName}`)
      .set('X-Tableau-Auth', 'valid-access-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {
            elicitation: {},
          },
          clientInfo: {
            name: 'tableau-mcp-tests',
            version: '1.0.0',
          },
        },
        jsonrpc: '2.0',
        id: 0,
      })
      .expect(200);

    const sessionId = response.headers['mcp-session-id'];

    request(app)
      .post(`/${serverName}`)
      .set('X-Tableau-Auth', 'valid-access-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
      })
      .pipe(awaitableWritableStream.stream);

    const messages = await awaitableWritableStream.getChunks((chunk) =>
      Buffer.from(chunk).toString('utf-8'),
    );

    expect(messages.length).toBeGreaterThan(0);
    const message = messages.join('');
    const lines = message.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe('event: message');
    const data = JSON.parse(lines[1].substring(lines[1].indexOf('data: ') + 6));
    expect(data).toMatchObject({ result: { tools: expect.any(Array) } });
  });

  it.skip('should pass the current request X-Tableau-Auth through extra.authInfo', async () => {
    vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');

    const { app } = await startServer();

    const getTableauAuthInfoSpy = vi.spyOn(getTableauAuthInfoModule, 'getTableauAuthInfo');

    const awaitableWritableStream = new AwaitableWritableStream();

    try {
      const response = await request(app)
        .post(`/${serverName}`)
        .set('X-Tableau-Auth', 'valid-access-token-1')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {
              elicitation: {},
            },
            clientInfo: {
              name: 'tableau-mcp-tests',
              version: '1.0.0',
            },
          },
          jsonrpc: '2.0',
          id: 0,
        })
        .expect(200);

      const sessionId = response.headers['mcp-session-id'];

      request(app)
        .post(`/${serverName}`)
        .set('X-Tableau-Auth', 'valid-access-token-2')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          method: 'tools/call',
          params: {
            name: 'list-datasources',
            arguments: {},
          },
          jsonrpc: '2.0',
          id: 1,
        })
        .pipe(awaitableWritableStream.stream);

      const messages = await awaitableWritableStream.getChunks((chunk) =>
        Buffer.from(chunk).toString('utf-8'),
      );

      expect(messages.length).toBeGreaterThan(0);
      const message = messages.join('');
      const lines = message.split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toBe('event: message');
      const data = JSON.parse(lines[1].substring(lines[1].indexOf('data: ') + 6));
      expect(data.error).toBeUndefined();
      expect(data.result).toMatchObject({ content: expect.any(Array) });

      const passthroughRawFromAuthInfo = getTableauAuthInfoSpy.mock.calls
        .map(([authInfo]) => authInfo?.extra)
        .filter(
          (extra): extra is PassthroughAuthInfo =>
            passthroughAuthInfoSchema.safeParse(extra).success,
        )
        .map((extra) => extra.raw);

      expect(passthroughRawFromAuthInfo.length).toBeGreaterThan(1);

      // Initialization request used the first header
      expect(passthroughRawFromAuthInfo[0]).toBe('valid-access-token-1');

      // Tool call used the second header
      expect(passthroughRawFromAuthInfo[1]).toBe('valid-access-token-2');
    } finally {
      getTableauAuthInfoSpy.mockRestore();
    }
  });

  it('should allow authenticated requests using the workgroup_session_id cookie', async () => {
    vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');

    const { app } = await startServer();

    const awaitableWritableStream = new AwaitableWritableStream();

    const response = await request(app)
      .post(`/${serverName}`)
      .set('Cookie', 'workgroup_session_id=valid-access-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {
            elicitation: {},
          },
          clientInfo: {
            name: 'tableau-mcp-tests',
            version: '1.0.0',
          },
        },
        jsonrpc: '2.0',
        id: 0,
      })
      .expect(200);

    const sessionId = response.headers['mcp-session-id'];

    request(app)
      .post(`/${serverName}`)
      .set('Cookie', 'workgroup_session_id=valid-access-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .set('mcp-session-id', sessionId)
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
      })
      .pipe(awaitableWritableStream.stream);

    const messages = await awaitableWritableStream.getChunks((chunk) =>
      Buffer.from(chunk).toString('utf-8'),
    );

    expect(messages.length).toBeGreaterThan(0);
    const message = messages.join('');
    const lines = message.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe('event: message');
    const data = JSON.parse(lines[1].substring(lines[1].indexOf('data: ') + 6));
    expect(data).toMatchObject({ result: { tools: expect.any(Array) } });
  });

  it('should reject token exchange when redirect_uri does not match authorization request', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const codeChallenge = 'test-code-challenge';
    const authzResponse = await request(app)
      .get('/oauth2/authorize')
      .query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: generateCodeChallenge(codeChallenge),
        code_challenge_method: 'S256',
        state: 'test-state',
      });

    const authzLocation = new URL(authzResponse.headers['location']);
    const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

    const callbackResponse = await request(app)
      .get('/Callback')
      .query({
        code: 'test-code',
        state: `${authKey}:${tableauState}`,
      });

    expect(callbackResponse.status).toBe(302);
    const location = new URL(callbackResponse.headers['location']);
    const code = location.searchParams.get('code');

    const tokenResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeChallenge,
      redirect_uri: 'http://localhost:9999/different',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });

    expect(tokenResponse.status).toBe(400);
    expect(tokenResponse.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Redirect URI mismatch',
    });
  });

  it('should succeed at token exchange when redirect_uri matches authorization request', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const tokenResponse = await exchangeAuthzCodeForAccessToken(app);

    expect(tokenResponse.access_token).toBeDefined();
    expect(tokenResponse.token_type).toBe('Bearer');
  });

  it('should reject token exchange when client_id does not match authorization request', async () => {
    // Add a second client pair so 'other-client-id' passes the credential check,
    // but it won't match the 'test-client-id' stored in the authorization code.
    vi.stubEnv(
      'OAUTH_CLIENT_ID_SECRET_PAIRS',
      'test-client-id:test-client-secret,other-client-id:other-client-secret',
    );

    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const codeChallenge = 'test-code-challenge';
    const authzResponse = await request(app)
      .get('/oauth2/authorize')
      .query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: generateCodeChallenge(codeChallenge),
        code_challenge_method: 'S256',
        state: 'test-state',
      });

    const authzLocation = new URL(authzResponse.headers['location']);
    const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

    const callbackResponse = await request(app)
      .get('/Callback')
      .query({
        code: 'test-code',
        state: `${authKey}:${tableauState}`,
      });

    expect(callbackResponse.status).toBe(302);
    const location = new URL(callbackResponse.headers['location']);
    const code = location.searchParams.get('code');

    const tokenResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeChallenge,
      redirect_uri: 'http://localhost:3000',
      client_id: 'other-client-id',
      client_secret: 'other-client-secret',
    });

    expect(tokenResponse.status).toBe(400);
    expect(tokenResponse.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Client ID mismatch',
    });
  });

  it('should succeed at token exchange when client_id is absent from token request', async () => {
    // Disable client credential pairs so the token endpoint doesn't require client_id.
    // This tests the "client_id is optional" path: if absent, the mismatch check is skipped.
    vi.stubEnv('OAUTH_CLIENT_ID_SECRET_PAIRS', '');

    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const codeChallenge = 'test-code-challenge';
    const authzResponse = await request(app)
      .get('/oauth2/authorize')
      .query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: generateCodeChallenge(codeChallenge),
        code_challenge_method: 'S256',
        state: 'test-state',
      });

    const authzLocation = new URL(authzResponse.headers['location']);
    const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

    const callbackResponse = await request(app)
      .get('/Callback')
      .query({
        code: 'test-code',
        state: `${authKey}:${tableauState}`,
      });

    expect(callbackResponse.status).toBe(302);
    const location = new URL(callbackResponse.headers['location']);
    const code = location.searchParams.get('code');

    const tokenResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeChallenge,
      redirect_uri: 'http://localhost:3000',
    });

    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.body.access_token).toBeDefined();
    expect(tokenResponse.body.token_type).toBe('Bearer');
  });

  it('should reject token exchange when client_id mismatches via Basic Auth (no body client_id)', async () => {
    vi.stubEnv(
      'OAUTH_CLIENT_ID_SECRET_PAIRS',
      'test-client-id:test-client-secret,other-client-id:other-client-secret',
    );

    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const codeChallenge = 'test-code-challenge';
    const authzResponse = await request(app)
      .get('/oauth2/authorize')
      .query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: generateCodeChallenge(codeChallenge),
        code_challenge_method: 'S256',
        state: 'test-state',
      });

    const authzLocation = new URL(authzResponse.headers['location']);
    const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

    const callbackResponse = await request(app)
      .get('/Callback')
      .query({
        code: 'test-code',
        state: `${authKey}:${tableauState}`,
      });

    expect(callbackResponse.status).toBe(302);
    const location = new URL(callbackResponse.headers['location']);
    const code = location.searchParams.get('code');

    // Send token request with Basic Auth as `other-client-id` but no `client_id` in body.
    // The effectiveClientId fallback should detect the mismatch.
    const basicAuth = Buffer.from('other-client-id:other-client-secret').toString('base64');
    const tokenResponse = await request(app)
      .post('/oauth2/token')
      .set('Authorization', `Basic ${basicAuth}`)
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeChallenge,
        redirect_uri: 'http://localhost:3000',
      });

    expect(tokenResponse.status).toBe(400);
    expect(tokenResponse.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Client ID mismatch',
    });
  });

  it('should reject if the access token is invalid or expired', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post(`/${serverName}`)
      .set('Authorization', 'Bearer invalid-token')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
      });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_token',
      error_description: 'Invalid or expired access token',
    });
  });

  // -------------------------------------------------------------------------
  // Token revocation (RFC 7009)
  //
  // Semantics implemented: refresh-grant revocation only.
  //
  // Revoking a refresh token prevents future refresh grants. Existing JWE
  // access tokens are NOT immediately invalidated — they remain usable until
  // their `exp` claim passes (default: 1 hour). This is the honest boundary
  // of what this implementation provides.
  // -------------------------------------------------------------------------

  it.skip('should revoke a valid refresh token and prevent subsequent refresh grants', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const { refresh_token } = await exchangeAuthzCodeForAccessToken(app);

    // Revoke the refresh token
    const revokeResponse = await request(app).post('/oauth2/revoke').send({ token: refresh_token });

    expect(revokeResponse.status).toBe(200);

    // Attempting to use the revoked refresh token should now fail
    const refreshResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });

    expect(refreshResponse.status).toBe(400);
    expect(refreshResponse.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });
  });

  it('should return 200 for an unknown or already-revoked token (RFC 7009 Section 2.2)', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/revoke')
      .send({ token: 'unknown-token-that-does-not-exist' });

    expect(response.status).toBe(200);
  });

  it('should return 200 for a garbage/malformed token (RFC 7009 Section 2.2)', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/revoke')
      .send({ token: '!!not-a-valid-token!!' });

    expect(response.status).toBe(200);
  });

  it('should return 400 when token field is missing from revoke request', async () => {
    const { app } = await startServer();

    const response = await request(app).post('/oauth2/revoke').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
  });

  it('should revoke a JWE access token, attempt signout, and delete the associated refresh token', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const { access_token, refresh_token } = await exchangeAuthzCodeForAccessToken(app);

    const revokeResponse = await request(app)
      .post('/oauth2/revoke')
      .send({ token: access_token, token_type_hint: 'access_token' });

    expect(revokeResponse.status).toBe(200);

    // The associated refresh token should be deleted; attempting to use it should fail
    const refreshResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });

    expect(refreshResponse.status).toBe(400);
    expect(refreshResponse.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });

    // The JWE itself is self-contained and remains structurally valid until its exp claim.
    // There is no deny-list, so the JWE can still be used for MCP requests.
    const mcpResponse = await request(app)
      .post(`/${serverName}`)
      .set('Authorization', `Bearer ${access_token}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'tableau-mcp-tests', version: '1.0.0' },
        },
        jsonrpc: '2.0',
        id: 0,
      });

    expect(mcpResponse.status).toBe(200);
  });

  it('should advertise revocation_endpoint in authorization server metadata (embedded mode)', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(200);
    expect(response.body.revocation_endpoint).toBe('http://127.0.0.1:3927/oauth2/revoke');
  });

  it('should NOT expose /.well-known/oauth-authorization-server in Tableau authorization server mode', async () => {
    // When OAUTH_EMBEDDED_AUTHZ_SERVER=false the MCP server acts as a resource server only.
    // The Tableau AS owns its own /.well-known/oauth-authorization-server; we must not
    // shadow it. Only the protected-resource metadata endpoint is registered.
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');

    const { app } = await startServer();

    const response = await request(app).get('/.well-known/oauth-authorization-server');
    expect(response.status).toBe(404);
  });

  it('should return 404 for POST /oauth2/revoke in Tableau authorization server mode', async () => {
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');

    const { app } = await startServer();

    const response = await request(app).post('/oauth2/revoke').send({ token: 'some-token' });

    expect(response.status).toBe(404);
  });
});
