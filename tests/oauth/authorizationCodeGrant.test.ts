import express from 'express';
import http from 'http';
import request from 'supertest';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { generateCodeChallenge } from '../../src/server/oauth/generateCodeChallenge.js';
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

describe('authorization code grant type', () => {
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

  describe('authorization code grant type', () => {
    it('should reject if the authorization code is invalid or expired', async () => {
      const { app } = await startServer();

      const tokenResponse = await request(app).post('/oauth/token').send({
        grant_type: 'authorization_code',
        code: 'invalid-code',
        code_verifier: 'test-code-challenge',
        redirect_uri: 'http://localhost:3000',
      });

      expect(tokenResponse.status).toBe(400);
      expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(tokenResponse.body).toEqual({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code',
      });
    });

    it('should reject if the code verifier is invalid', async () => {
      const { app } = await startServer();

      const codeChallenge = 'test-code-challenge';
      const authzResponse = await request(app)
        .get('/oauth/authorize')
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
      const code = location.searchParams.get('code');

      const tokenResponse = await request(app).post('/oauth/token').send({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'invalid-code-verifier',
        redirect_uri: 'http://localhost:3000',
      });

      expect(tokenResponse.status).toBe(400);
      expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(tokenResponse.body).toEqual({
        error: 'invalid_grant',
        error_description: 'Invalid code verifier',
      });
    });

    it('should issue an access token when the authorization code is successfully exchanged', async () => {
      const { app } = await startServer();
      await exchangeAuthzCodeForAccessToken(app);
    });
  });
});
