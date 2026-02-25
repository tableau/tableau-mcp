import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { AwaitableWritableStream } from './awaitableWritableStream.js';
import { exchangeAuthzCodeForAccessToken } from './exchangeAuthzCodeForAccessToken.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
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
