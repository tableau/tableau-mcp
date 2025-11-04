import express from 'express';
import http from 'http';
import request from 'supertest';

import { getConfig } from '../../src/config.js';
import { serverName } from '../../src/server.js';
import { startExpressServer } from '../../src/server/express.js';
import { generateCodeChallenge } from '../../src/server/oauth/generateCodeChallenge.js';
import { resetEnv, setEnv } from './testEnv.js';

describe('authorization code flow', () => {
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

  it('should redirect to Tableau OAuth', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/oauth/authorize').query({
      client_id: 'test-client-id',
      redirect_uri: 'http://localhost:3000',
      response_type: 'code',
      code_challenge: 'test-code-challenge',
      code_challenge_method: 'S256',
    });

    expect(response.status).toBe(302);

    const location = new URL(response.headers['location']);
    expect(location.hostname).toBe('10ax.online.tableau.com');
    expect(location.pathname).toBe('/oauth2/v1/auth');
    expect(location.searchParams.get('client_id')).not.toBeNull();
    expect(location.searchParams.get('code_challenge')).toBe(
      generateCodeChallenge('test-code-challenge'),
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3927/Callback');
    expect(location.searchParams.get('state')).not.toBeNull();
    expect(location.searchParams.get('state')).toContain(':');
    expect(location.searchParams.get('device_id')).not.toBeNull();
    expect(location.searchParams.get('target_site')).toBe('mcp-test');
    expect(location.searchParams.get('device_name')).toBe('tableau-mcp (Unknown agent)');
    expect(location.searchParams.get('client_type')).toBe('tableau-mcp');
  });

  describe('request validation', () => {
    it('should reject invalid request with missing parameters', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth/authorize');
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description:
          'Validation error: Client_id is required at "client_id"; Redirect_uri is required at "redirect_uri"; Response_type is required at "response_type"; Code_challenge is required at "code_challenge"; Code_challenge_method is required at "code_challenge_method"',
      });
    });

    it('should reject for invalid response_type', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth/authorize').query({
        client_id: 'test-client-id',
        redirect_uri: 'https://example.com',
        response_type: 'token',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'S256',
      });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported',
      });
    });

    it('should reject for invalid code_challenge_method', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth/authorize').query({
        client_id: 'test-client-id',
        redirect_uri: 'https://example.com',
        response_type: 'code',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'plain',
      });

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description: 'Only S256 code challenge method is supported',
      });
    });

    describe('redirect URI validation', () => {
      it('should reject redirect URIs that are not strings', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize').query({
          client_id: 'test-client-id',
          redirect_uri: 123,
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description: 'Invalid redirect URI: 123',
        });
      });

      it('should reject redirect URIs with invalid format', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize').query({
          client_id: 'test-client-id',
          redirect_uri: '🍔',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description: 'Invalid redirect URI: 🍔',
        });
      });

      it('should reject redirect URIs that are http but not localhost', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize').query({
          client_id: 'test-client-id',
          redirect_uri: 'http://example.com',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description: 'Invalid redirect URI: http://example.com',
        });
      });

      it('should reject redirect URIs that use an invalid protocol', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth/authorize').query({
          client_id: 'test-client-id',
          redirect_uri: '123http://example.com',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description: 'Invalid redirect URI: 123http://example.com',
        });
      });
    });
  });
});
