import express from 'express';
import http from 'http';
import request from 'supertest';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { generateCodeChallenge } from '../../src/server/oauth/generateCodeChallenge.js';
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

  describe('client credentials grant type', () => {
    it('should support the client credentials grant type', async () => {
      const { app } = await startServer();

      const response = await request(app).post('/oauth/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        access_token: expect.any(String),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read',
      });
    });

    it('should reject invalid client credentials of the same length', async () => {
      const { app } = await startServer();

      const response = await request(app).post('/oauth/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-cl1ent-secret',
      });

      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
    });

    it('should reject invalid client credentials of different lengths', async () => {
      const { app } = await startServer();

      const response = await request(app).post('/oauth/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret-123',
      });

      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      });
    });
  });

  describe('dynamic client registration', () => {
    it('should support dynamic client registration', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['https://example.com'],
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        client_id: 'mcp-public-client',
        redirect_uris: ['https://example.com'],
        grant_types: ['authorization_code', 'client_credentials'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'native',
      });
    });

    it('should support localhost over http', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['http://localhost:3000'],
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        client_id: 'mcp-public-client',
        redirect_uris: ['http://localhost:3000'],
        grant_types: ['authorization_code', 'client_credentials'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'native',
      });
    });

    it('should support 127.0.0.1 over http', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['http://127.0.0.1:3000'],
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        client_id: 'mcp-public-client',
        redirect_uris: ['http://127.0.0.1:3000'],
        grant_types: ['authorization_code', 'client_credentials'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'native',
      });
    });

    it('should support custom schemes', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['vscode://oauth/callback'],
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        client_id: 'mcp-public-client',
        redirect_uris: ['vscode://oauth/callback'],
        grant_types: ['authorization_code', 'client_credentials'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        application_type: 'native',
      });
    });

    it('should reject redirect URIs that are not strings', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: [123],
        });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris must be an array of strings',
      });
    });

    it('should reject redirect URIs with invalid format', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['🍔'],
        });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_redirect_uri',
        error_description: 'Invalid redirect URI format: 🍔',
      });
    });

    it('should reject redirect URIs that are http but not localhost', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['http://example.com'],
        });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_redirect_uri',
        error_description:
          'Invalid redirect URI: http://example.com. HTTP URIs must be localhost or 127.0.0.1',
      });
    });

    it('should reject redirect URIs that use an invalid protocol', async () => {
      const { app } = await startServer();

      const response = await request(app)
        .post('/oauth/register')
        .send({
          redirect_uris: ['123abc://example.com'],
        });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_redirect_uri',
        error_description: 'Invalid redirect URI format: 123abc://example.com',
      });
    });
  });

  describe('authorization code flow', () => {
    it('should redirect to Tableau OAuth', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth/authorize').query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'S256',
      });

      expect(response.status).toBe(302);

      const location = new URL(response.headers['location']);
      expect(location.hostname).toBe('10ax.online.tableau.com');
      expect(location.pathname).toBe('/oauth2/v1/auth');
      expect(location.searchParams.get('client_id')).not.toBeNull();
      expect(location.searchParams.get('code_challenge')).toBe(
        generateCodeChallenge('test-code-challenge'),
      );
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      expect(location.searchParams.get('response_type')).toBe('code');
      expect(location.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3927/Callback');
      expect(location.searchParams.get('state')).not.toBeNull();
      expect(location.searchParams.get('state')).toContain(':');
      expect(location.searchParams.get('device_id')).not.toBeNull();
      expect(location.searchParams.get('target_site')).toBe('mcp-test');
      expect(location.searchParams.get('device_name')).toBe('tableau-mcp (Unknown agent)');
      expect(location.searchParams.get('client_type')).toBe('tableau-mcp');
    });

    describe('request validation', () => {
      it('should reject invalid request with missing parameters', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize');
        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description:
            'Validation error: Client_id is required at "client_id"; Redirect_uri is required at "redirect_uri"; Response_type is required at "response_type"; Code_challenge is required at "code_challenge"; Code_challenge_method is required at "code_challenge_method"',
        });
      });

      it('should reject for invalid response_type', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize').query({
          client_id: 'test-client-id',
          redirect_uri: 'https://example.com',
          response_type: 'token',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'unsupported_response_type',
          error_description: 'Only authorization code flow is supported',
        });
      });

      it('should reject for invalid code_challenge_method', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize').query({
          client_id: 'test-client-id',
          redirect_uri: 'https://example.com',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'plain',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description: 'Only S256 code challenge method is supported',
        });
      });

      describe('redirect URI validation', () => {
        it('should reject redirect URIs that are not strings', async () => {
          const { app } = await startServer();

          const response = await request(app).get('/oauth/authorize').query({
            client_id: 'test-client-id',
            redirect_uri: 123,
            response_type: 'code',
            code_challenge: 'test-code-challenge',
            code_challenge_method: 'S256',
          });

          expect(response.status).toBe(400);
          expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
          expect(response.body).toEqual({
            error: 'invalid_request',
            error_description:
              'Invalid redirect URI: must use HTTPS, localhost HTTP, or custom scheme',
          });
        });

        it('should reject redirect URIs with invalid format', async () => {
          const { app } = await startServer();

          const response = await request(app).get('/oauth/authorize').query({
            client_id: 'test-client-id',
            redirect_uri: '🍔',
            response_type: 'code',
            code_challenge: 'test-code-challenge',
            code_challenge_method: 'S256',
          });

          expect(response.status).toBe(400);
          expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
          expect(response.body).toEqual({
            error: 'invalid_request',
            error_description:
              'Invalid redirect URI: must use HTTPS, localhost HTTP, or custom scheme',
          });
        });

        it('should reject redirect URIs that are http but not localhost', async () => {
          const { app } = await startServer();

          const response = await request(app).get('/oauth/authorize').query({
            client_id: 'test-client-id',
            redirect_uri: 'http://example.com',
            response_type: 'code',
            code_challenge: 'test-code-challenge',
            code_challenge_method: 'S256',
          });

          expect(response.status).toBe(400);
          expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
          expect(response.body).toEqual({
            error: 'invalid_request',
            error_description:
              'Invalid redirect URI: must use HTTPS, localhost HTTP, or custom scheme',
          });
        });

        it('should reject redirect URIs that use an invalid protocol', async () => {
          const { app } = await startServer();

          const response = await request(app).get('/oauth/authorize').query({
            client_id: 'test-client-id',
            redirect_uri: '🤷‍♂️://example.com',
            response_type: 'code',
            code_challenge: 'test-code-challenge',
            code_challenge_method: 'S256',
          });

          expect(response.status).toBe(400);
          expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
          expect(response.body).toEqual({
            error: 'invalid_request',
            error_description:
              'Invalid redirect URI: must use HTTPS, localhost HTTP, or custom scheme',
          });
        });
      });
    });
  });

  describe('authorization code callback', () => {
    it('should reject invalid request with missing parameters', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/Callback');
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description:
          'Validation error: Code is required at "code"; State is required at "state"',
      });
    });

    it('should reject if user denies authorization', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/Callback').query({
        error: 'access_denied',
      });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'access_denied',
        error_description: 'User denied authorization',
      });
    });

    it('should reject if state is invalid', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/Callback').query({
        code: 'test-code',
        state: 'invalid-state',
      });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description: 'Invalid state parameter',
      });
    });

    it('should reject if the Tableau access token is not successfully retrieved', async () => {
      const { app } = await startServer();

      const authzResponse = await request(app).get('/oauth/authorize').query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'S256',
        state: 'test-state',
      });

      const authzLocation = new URL(authzResponse.headers['location']);
      const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

      mocks.mockGetTokenResult.mockImplementation(() => {
        throw new Error('Unauthorized');
      });

      const response = await request(app)
        .get('/Callback')
        .query({
          code: 'test-code',
          state: `${authKey}:${tableauState}`,
        });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description: 'Failed to exchange authorization code: Unauthorized',
      });
    });

    it('should reject if the originHost returned by Tableau does not match the expected server', async () => {
      const { app } = await startServer();

      const authzResponse = await request(app).get('/oauth/authorize').query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'S256',
        state: 'test-state',
      });

      const authzLocation = new URL(authzResponse.headers['location']);
      const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

      mocks.mockGetTokenResult.mockResolvedValue({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresInSeconds: 3600,
        originHost: '10az.online.tableau.com',
      });

      const response = await request(app)
        .get('/Callback')
        .query({
          code: 'test-code',
          state: `${authKey}:${tableauState}`,
        });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description:
          'Invalid origin host: 10az.online.tableau.com. Expected: 10ax.online.tableau.com',
      });
    });

    it('should issue an authorization code when the Tableau access token is successfully retrieved', async () => {
      const { app } = await startServer();

      const authzResponse = await request(app).get('/oauth/authorize').query({
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'S256',
        state: 'test-state',
      });

      const authzLocation = new URL(authzResponse.headers['location']);
      const [authKey, tableauState] = authzLocation.searchParams.get('state')?.split(':') ?? [];

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

      const response = await request(app)
        .get('/Callback')
        .query({
          code: 'test-code',
          state: `${authKey}:${tableauState}`,
        });

      expect(response.status).toBe(302);
      const location = new URL(response.headers['location']);
      expect(location.origin).toBe('http://localhost:3000');
      expect(location.searchParams.get('code')).not.toBeNull();
      expect(location.searchParams.get('state')).toBe('test-state');
    });
  });
});
