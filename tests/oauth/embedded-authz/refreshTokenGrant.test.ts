import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../../src/config.js';
import { serverName } from '../../../src/server.js';
import { startExpressServer } from '../../../src/server/express.js';
import { exchangeAuthzCodeForAccessToken } from './exchangeAuthzCodeForAccessToken.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

describe('refresh token grant type', () => {
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

  it('should reject if the refresh token is invalid', async () => {
    const { app } = await startServer();

    const tokenResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token: 'invalid-refresh-token',
    });

    expect(tokenResponse.status).toBe(400);
    expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(tokenResponse.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });
  });

  it('should reject if the refresh token is expired', async () => {
    process.env.OAUTH_REFRESH_TOKEN_TIMEOUT_MS = '0';
    try {
      const { app } = await startServer();

      mocks.mockGetTokenResult.mockResolvedValue({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresInSeconds: 3600,
        originHost: '10ax.online.tableau.com',
      });

      const { refresh_token } = await exchangeAuthzCodeForAccessToken(app);

      const tokenResponse = await request(app).post('/oauth2/token').send({
        grant_type: 'refresh_token',
        refresh_token,
      });

      expect(tokenResponse.status).toBe(400);
      expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(tokenResponse.body).toEqual({
        error: 'invalid_grant',
        error_description: 'Invalid or expired refresh token',
      });
    } finally {
      process.env.OAUTH_REFRESH_TOKEN_TIMEOUT_MS = undefined;
    }
  });

  it('should issue an access token when the refresh token is successfully exchanged', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const { refresh_token } = await exchangeAuthzCodeForAccessToken(app);

    const tokenResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token,
    });

    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(tokenResponse.body).toEqual({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: '',
    });

    // Verify that the refresh token is rotated
    expect(tokenResponse.body.refresh_token).not.toBe(refresh_token);
  });
});
