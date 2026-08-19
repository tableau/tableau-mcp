import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../../src/config.js';
import { startExpressServer } from '../../../src/server/express.js';
import { resetEnv, setEnv } from './testEnv.js';

describe('dynamic client registration', () => {
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

  it('should support dynamic client registration', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/register')
      .send({
        redirect_uris: ['https://example.com'],
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body.client_id).toEqual(expect.any(String));
    expect(response.body.client_id).not.toBe('mcp-public-client');
    expect(response.body.client_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.body).toMatchObject({
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
      .post('/oauth2/register')
      .send({
        redirect_uris: ['http://localhost:3000'],
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body.client_id).toEqual(expect.any(String));
    expect(response.body.client_id).not.toBe('mcp-public-client');
    expect(response.body).toMatchObject({
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
      .post('/oauth2/register')
      .send({
        redirect_uris: ['http://127.0.0.1:3000'],
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body.client_id).toEqual(expect.any(String));
    expect(response.body.client_id).not.toBe('mcp-public-client');
    expect(response.body).toMatchObject({
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
      .post('/oauth2/register')
      .send({
        redirect_uris: ['vscode://oauth/callback'],
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body.client_id).toEqual(expect.any(String));
    expect(response.body.client_id).not.toBe('mcp-public-client');
    expect(response.body).toMatchObject({
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
      .post('/oauth2/register')
      .send({
        redirect_uris: [123],
      });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_redirect_uri',
      error_description: 'Invalid redirect URI: 123',
    });
  });

  it('should reject redirect URIs with invalid format', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/register')
      .send({
        redirect_uris: ['🍔'],
      });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_redirect_uri',
      error_description: 'Invalid redirect URI: 🍔',
    });
  });

  it('should reject redirect URIs that are http but not localhost', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/register')
      .send({
        redirect_uris: ['http://example.com'],
      });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_redirect_uri',
      error_description: 'Invalid redirect URI: http://example.com',
    });
  });

  it('should reject redirect URIs that use an invalid protocol', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/register')
      .send({
        redirect_uris: ['123abc://example.com'],
      });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toEqual({
      error: 'invalid_redirect_uri',
      error_description: 'Invalid redirect URI: 123abc://example.com',
    });
  });

  it('should enforce registered redirect URIs in authorize endpoint', async () => {
    const { app } = await startServer();

    // Register a client with a loopback redirect URI on port 3000
    const registerResponse = await request(app)
      .post('/oauth2/register')
      .send({
        redirect_uris: ['http://localhost:3000/callback'],
      });

    expect(registerResponse.status).toBe(200);
    const clientId = registerResponse.body.client_id;

    // Authorize with matching redirect URI on different port (should succeed due to loopback port flexibility)
    const authorizeResponse1 = await request(app).get('/oauth2/authorize').query({
      client_id: clientId,
      redirect_uri: 'http://localhost:9999/callback',
      response_type: 'code',
      code_challenge: 'test-code-challenge',
      code_challenge_method: 'S256',
    });

    expect(authorizeResponse1.status).toBe(302);

    // Authorize with non-matching redirect URI path (should fail)
    const authorizeResponse2 = await request(app).get('/oauth2/authorize').query({
      client_id: clientId,
      redirect_uri: 'http://localhost:3000/different',
      response_type: 'code',
      code_challenge: 'test-code-challenge',
      code_challenge_method: 'S256',
    });

    expect(authorizeResponse2.status).toBe(400);
    expect(authorizeResponse2.body).toEqual({
      error: 'invalid_request',
      error_description: 'Invalid redirect URI: http://localhost:3000/different',
    });
  });
});
