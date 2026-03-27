import express from 'express';
import http from 'http';
import request from 'supertest';
import { z } from 'zod';

import { getConfig } from '../../../src/config.js';
import { serverName } from '../../../src/server.js';
import { startExpressServer } from '../../../src/server/express.js';
import { getEnv, setEnv } from '../../testEnv.js';
import { exchangeAuthzCodeForAccessToken } from './exchangeAuthzCodeForAccessToken.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

describe('refresh token grant type', () => {
  let _server: http.Server | undefined;

  const { SERVER, SITE_NAME } = getEnv(
    z.object({
      SERVER: z.string(),
      SITE_NAME: z.string(),
    }),
  );

  beforeAll(setEnv);

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
    vi.stubEnv('OAUTH_REFRESH_TOKEN_TIMEOUT_MS', '0');

    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: `${new URL(SERVER).hostname}`,
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
  });

  it('should issue an access token when the refresh token is successfully exchanged', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresInSeconds: 3600,
      originHost: `${new URL(SERVER).hostname}`,
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
      originHost: `${new URL(SERVER).hostname}`,
    });

    const { refresh_token } = await exchangeAuthzCodeForAccessToken(app);

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresInSeconds: 3600,
      originHost: `${new URL(SERVER).hostname}`,
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
        site_namespace: SITE_NAME,
      }),
    );
  });

  it('should store updated tokens after successful refresh for subsequent refreshes', async () => {
    const { app } = await startServer();

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'initial-access-token',
      refreshToken: 'initial-refresh-token',
      expiresInSeconds: 3600,
      originHost: `${new URL(SERVER).hostname}`,
    });

    const { refresh_token: firstRefreshToken } = await exchangeAuthzCodeForAccessToken(app);

    // First refresh: Tableau issues new tokens
    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'refreshed-access-token-1',
      refreshToken: 'refreshed-refresh-token-1',
      expiresInSeconds: 3600,
      originHost: `${new URL(SERVER).hostname}`,
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
      originHost: `${new URL(SERVER).hostname}`,
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
        site_namespace: SITE_NAME,
      }),
    );
  });
});
