import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../../src/config.js';
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
      basePath: 'tableau-mcp',
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
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
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
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
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
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });

    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(tokenResponse.body).toEqual({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: expect.stringMatching(/tableau:mcp:/),
    });

    // Verify that the refresh token is rotated
    expect(tokenResponse.body.refresh_token).not.toBe(refresh_token);
  });

  it('should pass the site contentUrl as site_namespace during refresh', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const { refresh_token } = await exchangeAuthzCodeForAccessToken(app);

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });

    const refreshCall = mocks.mockGetTokenResult.mock.calls.at(-1);
    expect(refreshCall?.[1]).toEqual(
      expect.objectContaining({
        grant_type: 'refresh_token',
        site_namespace: 'mcp-test',
      }),
    );
  });

  it('should store updated tokens after successful refresh for subsequent refreshes', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'initial-access-token',
      refreshToken: 'initial-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const { refresh_token: firstRefreshToken } = await exchangeAuthzCodeForAccessToken(app);

    // First refresh: Tableau issues new tokens
    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'refreshed-access-token-1',
      refreshToken: 'refreshed-refresh-token-1',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const firstRefreshResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token: firstRefreshToken,
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });
    expect(firstRefreshResponse.status).toBe(200);

    // Second refresh: should use the NEW Tableau refresh token from the first refresh
    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'refreshed-access-token-2',
      refreshToken: 'refreshed-refresh-token-2',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const secondRefreshResponse = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token: firstRefreshResponse.body.refresh_token,
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
    });
    expect(secondRefreshResponse.status).toBe(200);

    // The second refresh call should have used the tokens from the first refresh,
    // not the original tokens
    const secondRefreshCall = mocks.mockGetTokenResult.mock.calls.at(-1);
    expect(secondRefreshCall?.[1]).toEqual(
      expect.objectContaining({
        grant_type: 'refresh_token',
        refresh_token: 'refreshed-refresh-token-1',
        site_namespace: 'mcp-test',
      }),
    );
  });

  it('should allow only one of two concurrent uses of the same refresh token (single-use rotation)', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    const { refresh_token } = await exchangeAuthzCodeForAccessToken(app);

    // Force a real async suspension during the Tableau round-trip so both concurrent requests
    // reach the refresh-token lookup before either finishes rotating. This makes the race
    // deterministic: with a non-atomic get() both requests read the same token and both succeed
    // (yielding two valid refresh tokens from one — the reported bug); an atomic consume() removes
    // the token on first read, so the second request sees undefined and is rejected.
    mocks.mockGetTokenResult.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                accessToken: 'refreshed-access-token',
                refreshToken: 'refreshed-refresh-token',
                expiresInSeconds: 3600,
                originHost: '10ax.online.tableau.com',
              }),
            25,
          ),
        ),
    );

    const sendRefresh = (): request.Test =>
      request(app).post('/oauth2/token').send({
        grant_type: 'refresh_token',
        refresh_token,
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      });

    const [first, second] = await Promise.all([sendRefresh(), sendRefresh()]);

    // Exactly one wins (200) and one loses (400) — never two 200s. Which one wins is
    // legitimately non-deterministic, so assert on the sorted status pair, not on identity.
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]);

    const rejected = [first, second].find((r) => r.status === 400)!;
    expect(rejected.body).toEqual({
      error: 'invalid_grant',
      error_description: 'Invalid or expired refresh token',
    });

    const accepted = [first, second].find((r) => r.status === 200)!;
    expect(accepted.body.refresh_token).toEqual(expect.any(String));
    expect(accepted.body.refresh_token).not.toBe(refresh_token);
  });
});
