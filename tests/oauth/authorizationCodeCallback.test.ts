import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

describe('authorization code callback', () => {
  let _server: http.Server | undefined;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(() => {
    vi.clearAllMocks();
    _server = undefined;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
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

  it('should reject if the request is invalid', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/Callback').query({
      error: 'invalid_request',
    });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_request',
      error_description:
        'Invalid request. Did you sign in to the wrong site? From your browser, please sign out of your site and reconnect your agent to Tableau MCP.',
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
      error_description: 'Failed to exchange authorization code',
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

  it('should reject if the user signs in to a different site other than the locked, expected site', async () => {
    vi.stubEnv('SITE_NAME', 'other-site');

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
        'User signed in to site: mcp-test. Expected site: other-site. Please reconnect your client and choose the [other-site] site in the site picker if prompted.',
    });
  });

  it('should issue an authorization code when the Tableau access token is successfully retrieved when site locking is disabled', async () => {
    vi.stubEnv('SITE_NAME', 'other-site');
    vi.stubEnv('OAUTH_LOCK_SITE', 'false');

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
    const searchParams = new URLSearchParams(
      authzLocation.hash.substring(authzLocation.hash.indexOf('?')),
    );

    const externalRedirectUrl = new URL(
      searchParams.get('externalRedirect') ?? '',
      authzLocation.origin,
    );

    const [authKey, tableauState] = externalRedirectUrl.searchParams.get('state')?.split(':') ?? [];

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

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

  it('should issue an authorization code when the Tableau access token is successfully retrieved when site locking is enabled', async () => {
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
