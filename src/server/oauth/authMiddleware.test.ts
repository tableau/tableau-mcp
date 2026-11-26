import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Err, Ok } from 'ts-results-es';
import type { Mock } from 'vitest';

import * as loggerModule from '../../logging/logger.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import { OAUTH_AUTH_CHALLENGE_GUIDANCE } from '../../utils/authErrorMessage.js';
import { AccessTokenValidator, ExternalAccessTokenValidator } from './accessTokenValidator.js';
import { authMiddleware, getOAuthChallenge } from './authMiddleware.js';
import {
  getRequiredApiScopesForTool,
  getRequiredMcpScopesForTool,
  getSupportedMcpScopes,
  getSupportedScopes,
  MCP_SITE_SETTINGS_READ_SCOPE,
  MCP_WILDCARD_SCOPE,
  PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE,
} from './scopes.js';
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

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

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

describe('authMiddleware WWW-Authenticate challenge (RFC 6750 §3)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names no error when the request carried no token', async () => {
    const middleware = authMiddleware(makeValidator(new Err('unused')));
    const req = { headers: {}, method: 'POST', body: {} } as unknown as AuthenticatedRequest;
    const res = makeRes();

    await middleware(req, res, vi.fn());

    expect(res.headers['WWW-Authenticate']).toContain('resource_metadata="');
    expect(res.headers['WWW-Authenticate']).not.toContain('error=');
  });

  it('challenges with invalid_token and the metadata URL when the token is rejected', async () => {
    const middleware = authMiddleware(makeValidator(new Err('token "expired"\nat 12:00')));
    const req = {
      headers: { authorization: 'Bearer bad-token' },
      method: 'POST',
      body: {},
    } as unknown as AuthenticatedRequest;
    const res = makeRes();

    await middleware(req, res, vi.fn());

    expect(res.statusCode).toBe(401);
    const header = res.headers['WWW-Authenticate'] as string;
    expect(header).toMatch(
      /^Bearer realm="MCP", resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource"/,
    );
    expect(header).toContain(
      'error="invalid_token", error_description="The access token is invalid or expired"',
    );
    // The validator's text stays in the body: it may hold characters a header value can't carry.
    expect(header).not.toContain('expired"\n');
    expect(res.body.error_description).toContain('token "expired"');
  });

  it.each([true, false])(
    'advertises supported scopes at initialize while keeping permission disclosure optional (API scopes=%s)',
    async (includeApiScopes) => {
      vi.stubEnv('ADVERTISE_API_SCOPES', String(includeApiScopes));
      const header = await getOAuthChallenge({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      });
      const scopes = /scope="([^"]*)"/.exec(header)![1].split(' ');
      const supported = await getSupportedScopes({ includeApiScopes });

      expect(scopes).toEqual(
        supported.filter((scope) => scope !== PUBLISH_WORKBOOK_PERMISSIONS_API_SCOPE),
      );
    },
  );

  it.each([true, false])(
    'challenges a tool request with its required scopes (API scopes=%s)',
    async (includeApiScopes) => {
      vi.stubEnv('ADVERTISE_API_SCOPES', String(includeApiScopes));
      const header = await getOAuthChallenge({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list-datasources', arguments: {} },
      });
      const scopes = /scope="([^"]*)"/.exec(header)![1].split(' ');
      const expectedScopes: string[] = [...getRequiredMcpScopesForTool('list-datasources')];
      if (includeApiScopes) {
        expectedScopes.push(...getRequiredApiScopesForTool('list-datasources'));
      }

      expect(scopes).toEqual(expectedScopes);
    },
  );

  it.each([undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' }])(
    'advertises only MCP scopes for a non-tool request: %j',
    async (body) => {
      vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
      const header = await getOAuthChallenge(body);
      const scopes = /scope="([^"]*)"/.exec(header)![1].split(' ');

      expect(scopes).toEqual(await getSupportedMcpScopes());
    },
  );

  it('sends the same challenge on an SSE request with a rejected token', async () => {
    const middleware = authMiddleware(makeValidator(new Err('token expired')));
    const req = {
      headers: { authorization: 'Bearer bad-token', accept: 'text/event-stream' },
      method: 'GET',
      body: {},
    } as unknown as AuthenticatedRequest;
    const res = makeRes();

    await middleware(req, res, vi.fn());

    expect(res.writeHead).toHaveBeenCalledWith(
      401,
      expect.objectContaining({
        'WWW-Authenticate': expect.stringContaining('error="invalid_token"'),
      }),
    );
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

  // Both tokens carry the mandatory site-settings scope so the only variable under test is
  // scaffold-data-app's per-tool API scope (tableau:packages:read) — not the orthogonal
  // mandatory-scope rule that subset mode applies to every grant when site settings are on.
  it.each([
    [['tableau:mcp_site_settings:read'], false],
    [['tableau:packages:read', 'tableau:mcp_site_settings:read'], true],
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
      expect(res.headers['WWW-Authenticate']).toContain('tableau:packages:read');
    }
  });
});

describe('step-up challenge preserves held scopes and names the missing ones (G4)', () => {
  // scaffold-data-app requires tableau:packages:read. The token holds an UNRELATED scope
  // (tableau:mcp:datasource:read) plus the mandatory site-settings scope, but not packages:read —
  // so the 403 step-up fires with only the per-tool scope as the variable.
  const REQUIRED_SCOPE = 'tableau:packages:read';
  const EXISTING_HELD_SCOPE = 'tableau:mcp:datasource:read';
  const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
  const NEVER_SCOPE = 'tableau:mcp:some-scope-never-granted-nor-required';

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

  async function driveStepUp(): Promise<any> {
    const authInfo = { scopes: [EXISTING_HELD_SCOPE, MANDATORY_SCOPE], clientId: 'test-client' };
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
    return { req, res, next };
  }

  it("includes the token's existing scopes in the step-up challenge", async () => {
    const { res } = await driveStepUp();
    const header = res.headers['WWW-Authenticate'] as string;
    const scopeList = /scope="([^"]*)"/.exec(header)![1].split(' ');
    expect(scopeList).toContain(REQUIRED_SCOPE); // required, was missing
    expect(scopeList).toContain(EXISTING_HELD_SCOPE); // preserved
    expect(scopeList).not.toContain(NEVER_SCOPE); // nothing invented
  });

  it('names the missing scopes and includes 403 guidance in the body', async () => {
    const { res } = await driveStepUp();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    expect(res.body.error_description).toContain(REQUIRED_SCOPE);
    expect(res.body.error_description).toContain('403'); // from OAUTH_INSUFFICIENT_SCOPE_GUIDANCE
  });
});

describe('scope-gap log level (G5)', () => {
  const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
  const TOOL_NAME = 'scaffold-data-app';

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

  const scopeLogCalls = (): unknown[][] =>
    vi
      .mocked(loggerModule.log)
      .mock.calls.filter(([a]) => (a as any).message?.includes('Insufficient scopes'));

  // A non-tools/call request (here initialize) whose token lacks the mandatory scope: the gate fires
  // (site settings on), but it is a startup request, not an under-scoped tool invocation.
  async function driveNonToolCall(): Promise<any> {
    const authInfo = { scopes: [], clientId: 'test-client' };
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
    return { req, res, next };
  }

  // A tools/call on an under-scoped tool: token holds only the mandatory scope, tool needs more.
  async function driveToolCall(): Promise<any> {
    const authInfo = { scopes: [MANDATORY_SCOPE], clientId: 'test-client' };
    const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
    const req = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: TOOL_NAME, arguments: { datappName: 'Sales Demo' } },
      },
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
  }

  it('logs at info (not error) when a non-tools/call request fails the scope gate', async () => {
    const { res } = await driveNonToolCall();
    expect(res.statusCode).toBe(403);
    const scopeLog = scopeLogCalls()[0];
    expect((scopeLog[0] as any).level).toBe('info');
  });

  it('keeps error level and tags the tool name for a tools/call scope failure', async () => {
    const { res } = await driveToolCall();
    expect(res.statusCode).toBe(403);
    const scopeLog = scopeLogCalls()[0];
    expect((scopeLog[0] as any).level).toBe('error');
    expect((scopeLog[0] as any).message).toContain(TOOL_NAME);
  });
});

describe('initialize with optional post-publish permission disclosure', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.isFeatureEnabled.mockResolvedValue(false);
  });

  it.each([true, false])(
    'accepts initialize without optional or unrelated API scopes (has projects:read=%s)',
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

      expect(next).toHaveBeenCalledOnce();
      expect(req.auth).toEqual(authInfo);
      expect(res.statusCode).toBeUndefined();
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

  // Both tokens carry the mandatory site-settings scope so the only variable under test is
  // list-datasources' required MCP scope (tableau:mcp:datasource:read), not the orthogonal
  // mandatory-scope rule subset mode applies to every grant when site settings are on.
  it.each([
    [['openid', 'profile', 'tableau:mcp_site_settings:read'], false],
    [['openid', 'tableau:mcp:datasource:read', 'tableau:mcp_site_settings:read'], true],
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
        expect(res.headers['WWW-Authenticate']).toContain('tableau:mcp:datasource:read');
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

describe('subset scope matching', () => {
  const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
  const clientId = 'test-client';

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false'); // enforceScopes on
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.isFeatureEnabled.mockResolvedValue(false);
  });

  // A proper subset of the supported MCP scopes: the full set minus its first scope.
  async function mcpSubset(): Promise<string[]> {
    const supported = await getSupportedMcpScopes(clientId);
    expect(supported.length).toBeGreaterThan(1);
    return supported.slice(1);
  }

  function initializeReq(scopes: string[]): {
    req: AuthenticatedRequest;
    res: any;
    next: Mock<() => void>;
    authInfo: { scopes: string[]; clientId: string };
    middleware: ReturnType<typeof authMiddleware>;
  } {
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
    const next = vi.fn<() => void>();
    return { req, res, next, authInfo, middleware };
  }

  it('accepts a subset token at initialize by default', async () => {
    // Site settings are on by default, so include the mandatory scope.
    const { req, res, next, authInfo, middleware } = initializeReq([
      ...(await mcpSubset()),
      MANDATORY_SCOPE,
    ]);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toEqual(authInfo);
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects a subset token missing the mandatory scope when API scopes are advertised', async () => {
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    // Site settings are on by default; the token omits the mandatory scope.
    const { req, res, next, middleware } = initializeReq(await mcpSubset());

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    expect(res.headers['WWW-Authenticate']).toContain(MANDATORY_SCOPE);
  });

  // Clients of a deployment that doesn't advertise API scopes were never offered the scope, and a
  // refresh keeps the original grant, so requiring it here would reject every existing token.
  it('accepts a token without the mandatory scope when API scopes are not advertised', async () => {
    const { req, res, next, authInfo, middleware } = initializeReq(
      await getSupportedMcpScopes(clientId),
    );

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toEqual(authInfo);
    expect(res.statusCode).toBeUndefined();
  });

  it('accepts a subset token without the mandatory scope when site settings are disabled', async () => {
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
    const { req, res, next, authInfo, middleware } = initializeReq(await mcpSubset()); // no mandatory scope

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toEqual(authInfo);
    expect(res.statusCode).toBeUndefined();
  });

  it('requires only the mandatory scope for a non-tool request', async () => {
    // A tools/list body is not a CallToolRequest, so no tool name is resolved.
    // This requires the mandatory scope only — a token with just the
    // mandatory scope (no MCP scopes at all) is accepted, proving the full set is not demanded.
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    const scopes = [MANDATORY_SCOPE];
    const authInfo = { scopes, clientId };
    const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
    const req = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toEqual(authInfo);
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects a non-tool request missing the mandatory scope when site settings are enabled', async () => {
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    const scopes: string[] = []; // neither mandatory nor any MCP scope
    const authInfo = { scopes, clientId };
    const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
    const req = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.headers['WWW-Authenticate']).toContain(MANDATORY_SCOPE);
  });

  it('does not enforce scopes at all when enforceScopes is off', async () => {
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'true'); // enforceScopes off
    const scopes: string[] = []; // empty grant
    const authInfo = { scopes, clientId };
    const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
    const { req, res, next } = initializeReq(scopes);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth).toEqual(authInfo);
    expect(res.statusCode).toBeUndefined();
  });
});

// Tool calls still enforce required scopes even though connections accept subset grants.
describe('subset-mode regression guards (G6)', () => {
  const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
  const clientId = 'test-client';

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false'); // enforceScopes on
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  async function drive(
    scopes: string[],
    body: unknown,
  ): Promise<{ req: AuthenticatedRequest; res: any; next: ReturnType<typeof vi.fn> }> {
    const authInfo = { scopes, clientId };
    const middleware = authMiddleware(makeValidator(new Ok(authInfo)));
    const req = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'POST',
      body,
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
  }

  const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  };
  const toolsListBody = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const callBody = (name: string): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: {} },
  });

  it('release N-1: a narrow older grant still initializes and still calls its tool when newer scopes exist', async () => {
    // "Release N-1" grant: exactly what list-datasources required before any later scope was added,
    // plus the mandatory scope. The server's full supported scope set is strictly larger — it carries
    // scopes for tools this token never granted, standing in for scopes introduced in later releases.
    const toolScopes = [
      ...getRequiredMcpScopesForTool('list-datasources'),
      ...getRequiredApiScopesForTool('list-datasources'),
    ];
    const grant = [...toolScopes, MANDATORY_SCOPE];
    const supported = await getSupportedMcpScopes(clientId);
    // Proves there ARE newer/other scopes the old grant does not hold — the regression this guards is
    // the gate demanding the full supported set (so a new scope would retroactively break N-1).
    expect(supported.length).toBeGreaterThan(
      getRequiredMcpScopesForTool('list-datasources').length,
    );

    const init = await drive(grant, initializeBody);
    expect(init.next).toHaveBeenCalledOnce();
    expect(init.res.statusCode).toBeUndefined();

    const call = await drive(grant, callBody('list-datasources'));
    expect(call.next).toHaveBeenCalledOnce();
    expect(call.res.statusCode).toBeUndefined();
  });

  it('read-only token: initialize succeeds and a read tool is callable', async () => {
    const readGrant = [
      ...getRequiredMcpScopesForTool('download-workbook'),
      ...getRequiredApiScopesForTool('download-workbook'),
      MANDATORY_SCOPE,
    ];

    const init = await drive(readGrant, initializeBody);
    expect(init.next).toHaveBeenCalledOnce();
    expect(init.res.statusCode).toBeUndefined();

    const list = await drive(readGrant, toolsListBody);
    expect(list.next).toHaveBeenCalledOnce();
    expect(list.res.statusCode).toBeUndefined();

    const read = await drive(readGrant, callBody('download-workbook'));
    expect(read.next).toHaveBeenCalledOnce();
    expect(read.res.statusCode).toBeUndefined();
  });

  it('read-only token: a write tool returns the step-up 403 naming the missing scope and preserving held scopes', async () => {
    const readGrant = [
      ...getRequiredMcpScopesForTool('download-workbook'),
      ...getRequiredApiScopesForTool('download-workbook'),
      MANDATORY_SCOPE,
    ];
    // publish-workbook (a write tool) requires scopes the read-only grant does not hold.
    const writeScope = getRequiredMcpScopesForTool('publish-workbook')[0];
    expect(readGrant).not.toContain(writeScope);

    const { res, next } = await drive(readGrant, callBody('publish-workbook'));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    expect(res.body.error_description).toContain(writeScope); // names the missing scope
    expect(res.body.error_description).toContain('403'); // Task-3 guidance
    const header = res.headers['WWW-Authenticate'] as string;
    const scopeList = /scope="([^"]*)"/.exec(header)![1].split(' ');
    expect(scopeList).toContain(writeScope); // required-but-missing
    expect(scopeList).toContain(MCP_SITE_SETTINGS_READ_SCOPE); // a held scope, preserved
  });

  it('names the mandatory scope once when the tool also requires it', async () => {
    // list-users carries the site-settings scope in its own API scopes, so a token without it is
    // missing it both per-tool and as the mandatory scope.
    expect(getRequiredApiScopesForTool('list-users')).toContain(MANDATORY_SCOPE);
    const grant = [...getRequiredMcpScopesForTool('list-users')];

    const { res } = await drive(grant, callBody('list-users'));

    expect(res.statusCode).toBe(403);
    expect(res.body.error_description.split(MANDATORY_SCOPE)).toHaveLength(2);
  });
});

describe('MCP wildcard scope', () => {
  const clientId = 'test-client';

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
    mocks.isFeatureEnabled.mockImplementation(
      async (flag: string) => flag === 'mcp-wildcard-scope',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.isFeatureEnabled.mockResolvedValue(false);
  });

  // `scopes` undefined sends no bearer token.
  async function drive(
    scopes: string[] | undefined,
    body: unknown,
  ): Promise<{ res: any; next: ReturnType<typeof vi.fn> }> {
    const middleware = authMiddleware(makeValidator(new Ok({ scopes, clientId })));
    const req = {
      headers: scopes ? { authorization: 'Bearer valid-token' } : {},
      method: 'POST',
      body,
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { res, next };
  }

  const challengeScopes = (res: any): string[] =>
    /scope="([^"]*)"/.exec(res.headers['WWW-Authenticate'])![1].split(' ');

  const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  };
  const toolsListBody = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const callBody = (name: string): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: {} },
  });

  it('asks for the wildcard instead of each MCP scope when no token is present', async () => {
    const { res } = await drive(undefined, initializeBody);

    expect(res.statusCode).toBe(401);
    expect(challengeScopes(res)).toEqual([MCP_WILDCARD_SCOPE]);
  });

  it('accepts the wildcard at initialize', async () => {
    const { res, next } = await drive([MCP_WILDCARD_SCOPE], initializeBody);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('still accepts every MCP scope listed explicitly at initialize', async () => {
    const { res, next } = await drive(await getSupportedMcpScopes(clientId), initializeBody);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('accepts the wildcard for a tool call', async () => {
    const { res, next } = await drive([MCP_WILDCARD_SCOPE], callBody('list-datasources'));

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('accepts a subset of explicit MCP scopes at initialize', async () => {
    const { res, next } = await drive(
      (await getSupportedMcpScopes(clientId)).slice(1),
      initializeBody,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });

  it('does not let the wildcard stand in for Tableau API scopes', async () => {
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    const apiScopes = getRequiredApiScopesForTool('list-datasources');
    const body = callBody('list-datasources');

    const rejected = await drive([MCP_WILDCARD_SCOPE], body);
    expect(rejected.res.statusCode).toBe(403);
    expect(challengeScopes(rejected.res)).toEqual(
      expect.arrayContaining([MCP_WILDCARD_SCOPE, ...apiScopes]),
    );

    const accepted = await drive([MCP_WILDCARD_SCOPE, ...apiScopes], body);
    expect(accepted.next).toHaveBeenCalledOnce();
  });

  it('does not let the wildcard stand in for the mandatory site-settings scope', async () => {
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');

    const { res } = await drive([MCP_WILDCARD_SCOPE], toolsListBody);

    expect(res.statusCode).toBe(403);
    expect(res.body.error_description).toContain(MCP_SITE_SETTINGS_READ_SCOPE);
  });

  it('names the MCP scope a tool needs, not the wildcard, when a tool call lacks it', async () => {
    const { res } = await drive(['tableau:mcp:workbook:read'], callBody('list-datasources'));

    expect(res.statusCode).toBe(403);
    expect(challengeScopes(res)).toContain('tableau:mcp:datasource:read');
    expect(challengeScopes(res)).not.toContain(MCP_WILDCARD_SCOPE);
  });

  describe('with the mcp-wildcard-scope flag off', () => {
    beforeEach(() => {
      mocks.isFeatureEnabled.mockResolvedValue(false);
    });

    it('asks for each MCP scope when no token is present', async () => {
      const { res } = await drive(undefined, initializeBody);

      expect(res.statusCode).toBe(401);
      expect(challengeScopes(res)).toEqual(await getSupportedMcpScopes());
    });

    it('rejects a wildcard-only token for a tool call', async () => {
      const { res, next } = await drive([MCP_WILDCARD_SCOPE], callBody('list-datasources'));

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(challengeScopes(res)).toContain('tableau:mcp:datasource:read');
    });

    it('accepts every MCP scope listed explicitly at initialize', async () => {
      const { next } = await drive(await getSupportedMcpScopes(clientId), initializeBody);

      expect(next).toHaveBeenCalledOnce();
    });
  });
});

// W-25002517: the signed confirmation tokens hash a pre-state read into the token, so run-flow,
// run-flow-task and the extract-refresh-task update tools gained API scopes for that read
// (flow_runs:read, flow_tasks:read, tasks:read), and tableau:tasks:write (not a Tableau scope) was
// corrected to tableau:tasks:update. A token consented before this release holds the tool's OLD
// scope set; these tests pin that such a token is challenged (403 insufficient_scope naming the new
// scopes) rather than reaching the tool. The arrays below are the scope sets on main before the
// change, written out literally so a future edit to toolScopeMap cannot silently move them.
describe('pre-change (main-era) tokens after the signed-token scope additions (W-25002517)', () => {
  const MANDATORY_SCOPE = 'tableau:mcp_site_settings:read';
  const clientId = 'test-client';

  const MAIN_ERA_GRANTS: Record<string, string[]> = {
    'run-flow': [
      'tableau:mcp:flow:run',
      'tableau:flows:run',
      'tableau:flows:read',
      'tableau:mcp_site_settings:read',
    ],
    'run-flow-task': [
      'tableau:mcp:flow:run',
      'tableau:flow_tasks:run',
      'tableau:mcp_site_settings:read',
    ],
    'update-cloud-extract-refresh-task': [
      'tableau:mcp:tasks:write',
      'tableau:tasks:write',
      'tableau:users:read',
      'tableau:mcp_site_settings:read',
    ],
    'confirm-update-cloud-extract-refresh-task': [
      'tableau:mcp:tasks:write',
      'tableau:tasks:write',
      'tableau:users:read',
      'tableau:mcp_site_settings:read',
    ],
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false'); // enforceScopes on
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    vi.stubEnv('OAUTH_RESOURCE_URI', 'https://mcp.example.com');
    vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
    // Flow read tools on too, so flow_runs:read / flow_tasks:read were already in main's advertised
    // set (list-flow-runs / list-flow-tasks) and the strict-mode test isolates the tasks:update rename.
    vi.stubEnv('FLOW_READ_TOOLS_ENABLED', 'true');
    vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.isFeatureEnabled.mockResolvedValue(false);
  });

  async function drive(
    scopes: string[],
    body: unknown,
  ): Promise<{ req: AuthenticatedRequest; res: any; next: ReturnType<typeof vi.fn> }> {
    const middleware = authMiddleware(makeValidator(new Ok({ scopes, clientId })));
    const req = {
      headers: { authorization: 'Bearer valid-token' },
      method: 'POST',
      body,
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();
    await middleware(req, res, next);
    return { req, res, next };
  }

  const callBody = (name: string): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: {} },
  });

  const initializeBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  };

  function challengeScopes(res: any): string[] {
    const header = res.headers['WWW-Authenticate'] as string;
    return /scope="([^"]*)"/.exec(header)![1].split(' ');
  }

  describe('subset mode: tools/call with the main-era grant', () => {
    beforeEach(() => {
      vi.stubEnv('DISABLE_STRICT_SCOPE_MATCH', 'true');
    });

    it.each([
      ['run-flow', ['tableau:flow_runs:read'], []],
      ['run-flow-task', ['tableau:flow_tasks:read', 'tableau:flow_runs:read'], []],
      [
        'update-cloud-extract-refresh-task',
        ['tableau:tasks:update', 'tableau:tasks:read'],
        ['tableau:tasks:write'],
      ],
      [
        'confirm-update-cloud-extract-refresh-task',
        ['tableau:tasks:update', 'tableau:tasks:read'],
        ['tableau:tasks:write'],
      ],
    ])(
      '%s: 403 insufficient_scope naming %j',
      async (toolName, expectedMissing, heldButObsolete) => {
        const grant = MAIN_ERA_GRANTS[toolName];
        for (const scope of expectedMissing) {
          // Guards the premise: the new scope really is required now and absent from the old grant.
          expect(getRequiredApiScopesForTool(toolName as any)).toContain(scope);
          expect(grant).not.toContain(scope);
        }

        const { res, next } = await drive(grant, callBody(toolName));

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toBe('insufficient_scope');
        const scopeList = challengeScopes(res);
        for (const scope of expectedMissing) {
          expect(scopeList).toContain(scope);
          expect(res.body.error_description).toContain(scope);
        }
        // Held scopes are preserved in the step-up challenge so re-consent does not narrow the grant.
        expect(scopeList).toContain(MANDATORY_SCOPE);
        for (const scope of heldButObsolete) {
          expect(scopeList).toContain(scope);
          // ...but the obsolete scope is not named as missing.
          expect(res.body.error_description).not.toContain(scope);
        }
      },
    );

    it('the main-era grant still initializes under subset mode (the gap surfaces per tool)', async () => {
      const { next, res } = await drive(MAIN_ERA_GRANTS['run-flow'], initializeBody);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeUndefined();
    });
  });

  describe('strict mode (default): initialize with the main-era full advertised set', () => {
    it('403s at initialize naming tableau:tasks:update for a grant with tasks:write instead', async () => {
      // Strict is the default (no DISABLE_STRICT_SCOPE_MATCH, flag off).
      mocks.isFeatureEnabled.mockResolvedValue(false);
      const current = await getSupportedScopes({ includeApiScopes: true, clientId });
      expect(current).toContain('tableau:tasks:update');
      // Main's full advertised set: identical except tasks:write where this release has tasks:update.
      // (With admin + flow read tools on, tasks:read / flow_runs:read / flow_tasks:read were already
      // advertised on main via list-extract-refresh-tasks / list-flow-runs / list-flow-tasks.)
      expect(current).toEqual(
        expect.arrayContaining([
          'tableau:tasks:read',
          'tableau:flow_runs:read',
          'tableau:flow_tasks:read',
        ]),
      );
      const mainEraFullSet = [
        ...current.filter((scope) => scope !== 'tableau:tasks:update'),
        'tableau:tasks:write',
      ];

      const { res, next } = await drive(mainEraFullSet, initializeBody);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('insufficient_scope');
      expect(res.body.error_description).toContain('tableau:tasks:update');
      // Only the corrected scope is missing — the rest of the main-era set is still accepted.
      expect(res.body.error_description).toMatch(/Missing required scopes: tableau:tasks:update\./);
      const scopeList = challengeScopes(res);
      expect(scopeList).toContain('tableau:tasks:update');
      // The challenge carries the full current list so the client re-consents once.
      for (const scope of current) {
        expect(scopeList).toContain(scope);
      }
    });

    it('accepts the current full advertised set at initialize', async () => {
      mocks.isFeatureEnabled.mockResolvedValue(false);
      const current = await getSupportedScopes({ includeApiScopes: true, clientId });

      const { res, next } = await drive(current, initializeBody);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeUndefined();
    });
  });
});
