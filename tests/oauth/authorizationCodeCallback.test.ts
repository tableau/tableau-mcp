import express from 'express';
import http from 'http';
import request from 'supertest';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
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

describe('authorization code callback', () => {
  let _server: http.Server | undefined;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(() => {
    vi.clearAllMocks();
    _server = undefined;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
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
