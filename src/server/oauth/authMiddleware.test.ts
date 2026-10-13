import { Err, Ok } from 'ts-results-es';

import { stubDefaultEnvVars } from '../../testShared.js';
import { OAUTH_AUTH_CHALLENGE_GUIDANCE } from '../../utils/authErrorMessage.js';
import { AccessTokenValidator } from './accessTokenValidator.js';
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
