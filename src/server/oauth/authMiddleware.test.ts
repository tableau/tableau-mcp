import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Err, Ok } from 'ts-results-es';

import { stubDefaultEnvVars } from '../../testShared.js';
import { OAUTH_AUTH_CHALLENGE_GUIDANCE } from '../../utils/authErrorMessage.js';
import { AccessTokenValidator, ExternalAccessTokenValidator } from './accessTokenValidator.js';
import { authMiddleware } from './authMiddleware.js';
import { getSupportedScopes, PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE } from './scopes.js';
import { AuthenticatedRequest } from './types.js';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.isFeatureEnabled }),
}));

// Minimal Express response double capturing status / headers / json body.
function makeRes(): any {
  const res: any = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    header(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    writeHead: vi.fn(() => res),
    write: vi.fn(),
    end: vi.fn(),
  };
  return res;
}

function makeValidator(result: Ok<any> | Err<string>): AccessTokenValidator {
  return { validate: vi.fn().mockResolvedValue(result) } as unknown as AccessTokenValidator;
}

describe('authMiddleware auth-error wording (W-23757363)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries the shared guidance in error_description while keeping the WWW-Authenticate challenge when no token is present', async () => {
    const middleware = authMiddleware(makeValidator(new Err('unused')));
    const req = { headers: {}, method: 'POST', body: {} } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    // The re-auth challenge must remain intact so the OAuth flow still works.
    expect(res.headers['WWW-Authenticate']).toContain('Bearer realm="MCP"');
    expect(res.body.error).toBe('unauthorized');
    expect(res.body.error_description).toContain('Use the OAuth 2.1 flow');
    expect(res.body.error_description).toContain(OAUTH_AUTH_CHALLENGE_GUIDANCE);
  });

  it('carries the shared guidance in error_description for an invalid/expired token', async () => {
    const middleware = authMiddleware(makeValidator(new Err('token expired')));
    const req = {
      headers: { authorization: 'Bearer bad-token' },
      method: 'POST',
      body: {},
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    // Underlying validation detail is preserved, followed by the shared guidance.
    expect(res.body.error_description).toContain('token expired');
    expect(res.body.error_description).toContain(OAUTH_AUTH_CHALLENGE_GUIDANCE);
  });
});

describe('scaffold-data-app required API scope', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [[], false],
    [['tableau:packages:read'], true],
  ])('checks packages:read on a valid token with scopes %j', async (scopes, authorized) => {
    const authInfo = { scopes, clientId: 'test-client' };
    const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
    const req = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'scaffold-data-app', arguments: { datappName: 'Sales Demo' } },
      },
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    if (authorized) {
      expect(next).toHaveBeenCalledOnce();
      expect(req.auth).toEqual(authInfo);
      expect(res.statusCode).toBeUndefined();
    } else {
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('insufficient_scope');
      expect(res.headers['WWW-Authenticate']).toContain('scope="tableau:packages:read"');
    }
  });
});

describe('initialize with optional post-publish permission disclosure', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
    mocks.isFeatureEnabled.mockImplementation(async (flag: string) =>
      ['authoring-tools', 'data-apps'].includes(flag),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.isFeatureEnabled.mockResolvedValue(false);
  });

  it.each([true, false])(
    'keeps permission disclosure optional while enforcing required scopes (has projects:read=%s)',
    async (hasProjectsRead) => {
      const clientId = 'https://chatgpt.com/connector';
      const advertisedScopes = await getSupportedScopes({ includeApiScopes: true, clientId });
      expect(advertisedScopes).toContain(PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE);
      expect(advertisedScopes).toContain('tableau:projects:read');

      const scopes = advertisedScopes.filter(
        (scope) =>
          scope !== PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE &&
          (hasProjectsRead || scope !== 'tableau:projects:read'),
      );
      const authInfo = { scopes, clientId };
      const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
      const req = {
        headers: { authorization: 'Bearer valid-token' },
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        },
      } as unknown as AuthenticatedRequest;
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      if (hasProjectsRead) {
        expect(next).toHaveBeenCalledOnce();
        expect(req.auth).toEqual(authInfo);
        expect(res.statusCode).toBeUndefined();
      } else {
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('insufficient_scope');
        expect(res.headers['WWW-Authenticate']).toContain('tableau:projects:read');
        expect(res.headers['WWW-Authenticate']).not.toContain(
          PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE,
        );
      }
    },
  );
});

describe('external authorization server token scopes', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('AUTH', 'direct-trust');
    vi.stubEnv('JWT_SUB_CLAIM', '{OAUTH_USERNAME}');
    vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'connected-app-client-id');
    vi.stubEnv('CONNECTED_APP_SECRET_ID', 'connected-app-secret-id');
    vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'connected-app-secret-value');
    vi.stubEnv('OAUTH_ISSUER', 'https://idp.example.com');
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
    vi.stubEnv('OAUTH_EXTERNAL_DISCOVERY', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  it.each([
    [['openid', 'profile'], false],
    [['openid', 'tableau:mcp:datasource:read'], true],
  ])(
    'checks tableau:mcp:datasource:read on an external token with scopes %j',
    async (scopes, authorized) => {
      const { privateKey, publicKey } = await generateKeyPair('RS256');
      const getKey = createLocalJWKSet({
        keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }],
      });
      const token = await new SignJWT({
        aud: 'https://mcp.example.com/tableau-mcp',
        client_id: 'mcp-client',
        scope: scopes.join(' '),
        sub: 'jdoe@example.com',
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
        .setIssuer('https://idp.example.com')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
      const middleware = authMiddleware(new ExternalAccessTokenValidator({ getKey }));
      const req = {
        headers: { authorization: `Bearer ${token}` },
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list-datasources', arguments: {} },
        },
      } as unknown as AuthenticatedRequest;
      const res = makeRes();
      const next = vi.fn();

      await middleware(req, res, next);

      if (authorized) {
        expect(next).toHaveBeenCalledOnce();
        expect(req.auth?.extra).toMatchObject({
          type: 'X-Tableau-Auth',
          username: 'jdoe@example.com',
        });
        expect(res.statusCode).toBeUndefined();
      } else {
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('insufficient_scope');
        expect(res.headers['WWW-Authenticate']).toContain('scope="tableau:mcp:datasource:read"');
      }
    },
  );
});

describe('external OIDC ID tokens', () => {
  const OWN_CLIENT_ID = 'tableau-mcp-client';
  let privateKey: CryptoKey;
  let getKey: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256');
    privateKey = keyPair.privateKey;
    getKey = createLocalJWKSet({
      keys: [{ ...(await exportJWK(keyPair.publicKey)), alg: 'RS256', kid: 'id-key-1' }],
    });
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('AUTH', 'direct-trust');
    vi.stubEnv('JWT_SUB_CLAIM', '{OAUTH_USERNAME}');
    vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'connected-app-client-id');
    vi.stubEnv('CONNECTED_APP_SECRET_ID', 'connected-app-secret-id');
    vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'connected-app-secret-value');
    vi.stubEnv('OAUTH_ISSUER', 'https://idp.example.com');
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
    vi.stubEnv('OAUTH_EXTERNAL_DISCOVERY', 'true');
    vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', OWN_CLIENT_ID);
    vi.stubEnv('OAUTH_EXTERNAL_USERNAME_CLAIM_NAME', 'employee_id');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  async function idToken(aud: string): Promise<string> {
    return new SignJWT({
      sub: 'u-7f3a9c2e-opaque',
      aud,
      auth_time: Math.floor(Date.now() / 1000) - 30,
      nonce: 'n-0S6_WzA2Mj',
      employee_id: '1234567',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'id-key-1' })
      .setIssuer('https://idp.example.com')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  async function callListDatasources(
    token: string,
  ): Promise<{ req: AuthenticatedRequest; res: any; next: ReturnType<typeof vi.fn> }> {
    const middleware = authMiddleware(new ExternalAccessTokenValidator({ getKey }));
    const req = {
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list-datasources', arguments: {} },
      },
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
  }

  it('accepts an ID token for this server when scopes are disabled', async () => {
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'true');

    const { req, res, next } = await callListDatasources(await idToken(OWN_CLIENT_ID));

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth?.extra).toMatchObject({ type: 'X-Tableau-Auth', username: '1234567' });
    expect(res.statusCode).toBeUndefined();
  });

  it('refuses an ID token without tableau:mcp:* scopes when scopes are enforced', async () => {
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');

    const { res, next } = await callListDatasources(await idToken(OWN_CLIENT_ID));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });

  it('rejects an ID token for another client with the generic invalid-token error', async () => {
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'true');

    const { res, next } = await callListDatasources(await idToken('other-client'));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.body.error_description).toBe(
      `Invalid or expired access token. ${OAUTH_AUTH_CHALLENGE_GUIDANCE}`,
    );
    expect(JSON.stringify({ body: res.body, headers: res.headers })).not.toMatch(/audience/i);
  });
});
