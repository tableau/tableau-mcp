import express from 'express';
import http from 'http';
import request from 'supertest';

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

describe('client credentials grant type', () => {
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

  it('should issue an access token when the client credentials are valid', async () => {
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

  it('should issue an access token when the client credentials are valid on the authorization header', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth/token')
      .set(
        'Authorization',
        `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`,
      )
      .send({
        grant_type: 'client_credentials',
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

  it('should reject when the authorization header is not the Basic type', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth/token')
      .set('Authorization', 'Bearer test-client-id:test-client-secret')
      .send({
        grant_type: 'client_credentials',
      });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_client',
      error_description: 'Invalid authorization type',
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
