import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { resetEnv, setEnv } from './testEnv.js';

describe('OAuth', () => {
  let _server: http.Server | undefined;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(async () => {
    _server = undefined;
  });

  afterEach(async () => {
    _server?.close();
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
