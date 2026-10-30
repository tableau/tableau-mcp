import express from 'express';
import http from 'http';

import { getConfig } from '../../../src/config.js';
import { startExpressServer } from '../../../src/server/express.js';
import { generateCodeChallenge } from '../../../src/server/oauth/generateCodeChallenge.js';
import request from '../../../src/testLoopbackRequest.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  // Lets a test force the strict-scope-match flag on; otherwise delegates to the real gate.
  strictFlag: { value: false },
}));

// Override the feature gate for this file so the strict-scope-match flag is controllable per-test.
// Composes with the shared testSetup mock (admin-tools forcing lives there); this file's mock wins.
vi.mock('../../../src/features/init.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/features/init.js')>();
  return {
    ...original,
    getFeatureGate: () => {
      const featureGate = original.getFeatureGate();
      return {
        isFeatureEnabled: async (featureName: string) => {
          if (featureName === 'enforce-strict-scope-match') {
            return mocks.strictFlag.value;
          }
          return featureName === 'admin-tools' || featureGate.isFeatureEnabled(featureName);
        },
      };
    },
  };
});

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

  it('should redirect to Tableau OAuth', async () => {
    const { app } = await startServer();

    const response = await request(app).get('/oauth2/authorize').query({
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
    expect(location.searchParams.get('code_challenge')).not.toBe(
      generateCodeChallenge('test-code-challenge'),
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3927/Callback');
    expect(location.searchParams.get('state')).not.toBeNull();
    expect(location.searchParams.get('state')).toContain(':');
    expect(location.searchParams.get('device_id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(location.searchParams.get('target_site')).toBe('mcp-test');
    expect(location.searchParams.get('device_name')).toBe('tableau-mcp (Unknown agent)');
    expect(location.searchParams.get('client_type')).toBe('tableau-mcp');
  });

  describe('request validation', () => {
    it('should reject invalid request with missing parameters', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth2/authorize');
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description:
          'Validation error: client_id is required at "client_id"; redirect_uri is required at "redirect_uri"; response_type is required at "response_type"; code_challenge is required at "code_challenge"; code_challenge_method is required at "code_challenge_method"',
      });
    });

    it('should reject for invalid response_type', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth2/authorize').query({
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

      const response = await request(app).get('/oauth2/authorize').query({
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

        const response = await request(app).get('/oauth2/authorize').query({
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

        const response = await request(app).get('/oauth2/authorize').query({
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

        const response = await request(app).get('/oauth2/authorize').query({
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

        const response = await request(app).get('/oauth2/authorize').query({
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

    describe('opaque client_id security - reject remote https for unknown clients', () => {
      it('should reject remote https redirect URI for unknown opaque client_id', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth2/authorize').query({
          client_id: 'unknown-opaque-client',
          redirect_uri: 'https://evil.example.com/cb',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(400);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.body).toEqual({
          error: 'invalid_request',
          error_description: 'Invalid redirect URI: https://evil.example.com/cb',
        });
      });

      it('should allow loopback http for unknown opaque client_id', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth2/authorize').query({
          client_id: 'unknown-opaque-client',
          redirect_uri: 'http://localhost:3000',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(302);
      });

      it('should allow custom scheme for unknown opaque client_id', async () => {
        const { app } = await startServer();

        const response = await request(app).get('/oauth2/authorize').query({
          client_id: 'unknown-opaque-client',
          redirect_uri: 'cursor://cb',
          response_type: 'code',
          code_challenge: 'test-code-challenge',
          code_challenge_method: 'S256',
        });

        expect(response.status).toBe(302);
      });
    });
  });

  describe('mandatory site-settings scope under subset matching', () => {
    const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
    // A supported MCP scope that is NOT the mandatory scope, so requesting just this omits it.
    const SUBSET_SCOPE = 'tableau:mcp:datasource:read';

    function authorizeQuery(scope: string): Record<string, string> {
      return {
        client_id: 'test-client-id',
        redirect_uri: 'http://localhost:3000',
        response_type: 'code',
        code_challenge: 'test-code-challenge',
        code_challenge_method: 'S256',
        scope,
      };
    }

    beforeEach(() => {
      // enforceScopes on; the suite default is OAUTH_DISABLE_SCOPES=true (enforcement off).
      vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
      mocks.strictFlag.value = false;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      mocks.strictFlag.value = false;
    });

    it('rejects /authorize when the requested scopes omit the mandatory scope, site settings on, strict off', async () => {
      const { app } = await startServer();

      const response = await request(app).get('/oauth2/authorize').query(authorizeQuery(SUBSET_SCOPE));

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_scope');
      expect(response.body.error_description).toContain(MANDATORY_SCOPE);
    });

    it('redirects (does not reject) when strict scope match is on, even for the same subset', async () => {
      vi.stubEnv('ENFORCE_STRICT_SCOPE_MATCH', 'true');
      mocks.strictFlag.value = true;
      const { app } = await startServer();

      const response = await request(app).get('/oauth2/authorize').query(authorizeQuery(SUBSET_SCOPE));

      expect(response.status).toBe(302);
    });

    it('redirects (does not reject) when MCP site settings are disabled, even for the same subset', async () => {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
      const { app } = await startServer();

      const response = await request(app).get('/oauth2/authorize').query(authorizeQuery(SUBSET_SCOPE));

      expect(response.status).toBe(302);
    });
  });
});
