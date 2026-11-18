import express from 'express';
import http from 'http';

import { getConfig } from '../../../src/config.js';
import { startExpressServer } from '../../../src/server/express.js';
import request from '../../../src/testLoopbackRequest.js';
import { resetEnv, setEnv } from './testEnv.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
  // Lets a test turn the disable-strict-scope-match flag off (strict on); otherwise delegates to the
  // real gate.
  disableStrictFlag: { value: true },
  mcpWildcardScopeFlag: { value: false },
}));

vi.mock('../../../src/sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

// Override the feature gate for this file so the disable-strict-scope-match flag is controllable
// per-test.
// Composes with the shared testSetup mock (admin-tools forcing lives there); this file's mock wins.
vi.mock('../../../src/features/init.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/features/init.js')>();
  return {
    ...original,
    getFeatureGate: () => {
      const featureGate = original.getFeatureGate();
      return {
        isFeatureEnabled: async (featureName: string) => {
          if (featureName === 'disable-strict-scope-match') {
            return mocks.disableStrictFlag.value;
          }
          if (featureName === 'mcp-wildcard-scope') {
            return mocks.mcpWildcardScopeFlag.value;
          }
          return featureName === 'admin-tools' || featureGate.isFeatureEnabled(featureName);
        },
      };
    },
  };
});

describe('client credentials grant type', () => {
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

  it('should issue an access token when the client credentials are valid', async () => {
    const { app } = await startServer();

    const response = await request(app).post('/oauth2/token').send({
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
      scope: expect.stringMatching(/tableau:mcp:/),
    });
  });

  it('should issue an access token when the client credentials are valid on the authorization header', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/token')
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
      scope: expect.stringMatching(/tableau:mcp:/),
    });
  });

  it('should reject when the authorization header is not the Basic type', async () => {
    const { app } = await startServer();

    const response = await request(app)
      .post('/oauth2/token')
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

    const response = await request(app).post('/oauth2/token').send({
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

    const response = await request(app).post('/oauth2/token').send({
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

  describe('MCP wildcard scope', () => {
    beforeEach(() => {
      // enforceScopes on; the suite default is OAUTH_DISABLE_SCOPES=true (enforcement off).
      vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
      mocks.mcpWildcardScopeFlag.value = true;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      mocks.mcpWildcardScopeFlag.value = false;
    });

    it('grants the explicit MCP scopes and rejects a request for the wildcard when the flag is off', async () => {
      mocks.mcpWildcardScopeFlag.value = false;
      const { app } = await startServer();

      const granted = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      });
      expect(granted.status).toBe(200);
      expect(granted.body.scope).toContain('tableau:mcp:datasource:read');
      expect(granted.body.scope).not.toContain('tableau:mcp:*');

      const rejected = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        scope: 'tableau:mcp:*',
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toBe('invalid_scope');
    });

    it('grants the wildcard when no scopes are requested', async () => {
      const { app } = await startServer();

      const response = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
      });

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('tableau:mcp:*');
    });

    it('accepts a request for the wildcard', async () => {
      const { app } = await startServer();

      const response = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        scope: 'tableau:mcp:*',
      });

      expect(response.status).toBe(200);
      expect(response.body.scope).toBe('tableau:mcp:*');
    });
  });

  describe('mandatory site-settings scope under subset matching', () => {
    const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
    // A supported MCP scope that is NOT the mandatory scope, so a grant of just this omits it.
    const SUBSET_SCOPE = 'tableau:mcp:datasource:read';

    beforeEach(() => {
      // enforceScopes on; the suite default is OAUTH_DISABLE_SCOPES=true (enforcement off).
      vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
      // The scope is required only when API scopes are advertised.
      vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
      mocks.disableStrictFlag.value = true;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      mocks.disableStrictFlag.value = true;
    });

    it('mints the token when API scopes are not advertised, even for a subset omitting the mandatory scope', async () => {
      vi.stubEnv('ADVERTISE_API_SCOPES', 'false');
      const { app } = await startServer();

      const response = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        scope: SUBSET_SCOPE,
      });

      expect(response.status).toBe(200);
      expect(response.body.access_token).toEqual(expect.any(String));
    });

    it('rejects a client_credentials grant that omits the mandatory scope when site settings are on and strict is off', async () => {
      const { app } = await startServer();

      const response = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        scope: SUBSET_SCOPE,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_scope');
      expect(response.body.error_description).toContain(MANDATORY_SCOPE);
    });

    it('mints the token when strict scope match is on, even for the same subset', async () => {
      mocks.disableStrictFlag.value = false;
      const { app } = await startServer();

      const response = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        scope: SUBSET_SCOPE,
      });

      expect(response.status).toBe(200);
      expect(response.body.access_token).toEqual(expect.any(String));
    });

    it('mints the token when MCP site settings are disabled, even for a subset omitting the mandatory scope', async () => {
      vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
      const { app } = await startServer();

      const response = await request(app).post('/oauth2/token').send({
        grant_type: 'client_credentials',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        scope: SUBSET_SCOPE,
      });

      expect(response.status).toBe(200);
      expect(response.body.access_token).toEqual(expect.any(String));
    });
  });
});
