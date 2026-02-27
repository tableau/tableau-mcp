import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
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
      basePath: serverName,
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
      .post('/oauth2/register')
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
      .post('/oauth2/register')
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
      .post('/oauth2/register')
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
});
