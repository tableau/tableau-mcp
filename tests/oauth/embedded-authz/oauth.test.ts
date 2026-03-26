import express from 'express';
import http from 'http';
import request from 'supertest';
import { z } from 'zod';

import { getConfig } from '../../../src/config.js';
import { serverName } from '../../../src/server.js';
import { startExpressServer } from '../../../src/server/express.js';
import { generateCodeChallenge } from '../../../src/server/oauth/generateCodeChallenge.js';
import { getEnv } from '../../testEnv.js';
import { AwaitableWritableStream } from './awaitableWritableStream.js';
import { exchangeAuthzCodeForAccessToken } from './exchangeAuthzCodeForAccessToken.js';

const { SERVER } = getEnv(
  z.object({
    SERVER: z.string(),
  }),
);

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

describe('OAuth', () => {
  let _server: http.Server | undefined;

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
      originHost: new URL(SERVER).hostname,
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
      originHost: new URL(SERVER).hostname,
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
      originHost: new URL(SERVER).hostname,
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
      originHost: new URL(SERVER).hostname,
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
      originHost: new URL(SERVER).hostname,
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
      originHost: new URL(SERVER).hostname,
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
});
