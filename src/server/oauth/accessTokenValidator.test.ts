import { generateKeyPairSync } from 'crypto';
import {
  CompactEncrypt,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  JWTVerifyGetKey,
  SignJWT,
} from 'jose';
import { Err, Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import {
  EmbeddedAccessTokenValidator,
  ExternalAccessTokenValidator,
  matchAudience,
  TableauAccessTokenValidator,
} from './accessTokenValidator.js';

const MOCK_ISSUER = 'https://sso.online.tableau.com';
const MOCK_CLIENT_ID = 'https://cimd.example.com/oauth/metadata.json';
const MOCK_RESOURCE_URI = 'https://mcp.example.com';
const MOCK_GLOBAL_RESOURCE_URI = 'https://global.example.com';
const EXPECTED_AUD = `${MOCK_RESOURCE_URI}/tableau-mcp`;
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

function makeBearer(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesignature`;
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: MOCK_ISSUER,
    aud: EXPECTED_AUD,
    exp: FUTURE_EXP,
    sub: 'user@example.com',
    scope: 'tableau:views:read tableau:datasources:read',
    client_id: MOCK_CLIENT_ID,
    'https://tableau.com/siteId': 'abc123',
    'https://tableau.com/userId': 'uid-1',
    'https://tableau.com/targetUrl': 'https://my-tableau.example.com',
    ...overrides,
  };
}

describe('TableauAccessTokenValidator', () => {
  let validator: TableauAccessTokenValidator;

  beforeEach(() => {
    vi.stubEnv('AUTH', 'oauth');
    vi.stubEnv('OAUTH_ISSUER', MOCK_ISSUER);
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', MOCK_RESOURCE_URI);
    validator = new TableauAccessTokenValidator();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('client_id claim resolution', () => {
    it('uses the client_id claim as the OAuth client ID', async () => {
      const token = makeBearer(basePayload());
      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const extra = result.value.extra as { clientId?: string };
      expect(extra.clientId).toBe(MOCK_CLIENT_ID);
    });

    it('never derives the client ID from aud (the resource URL)', async () => {
      const token = makeBearer(basePayload());
      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const extra = result.value.extra as { clientId?: string };
      expect(extra.clientId).not.toBe(EXPECTED_AUD);
    });

    it('rejects token when client_id is missing (schema enforcement)', async () => {
      const { client_id: _clientId, ...withoutClientId } = basePayload() as Record<string, unknown>;
      const token = makeBearer(withoutClientId);
      const result = await validator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toMatch(/Invalid access token/);
    });

    it('rejects token when aud is missing (schema enforcement)', async () => {
      const { aud: _aud, ...withoutAud } = basePayload() as Record<string, unknown>;
      const token = makeBearer(withoutAud);
      const result = await validator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toMatch(/Invalid access token/);
    });
  });

  describe('standard validation', () => {
    it('returns AuthInfo.clientId as the resolved OAuth client_id', async () => {
      const token = makeBearer(basePayload());
      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.clientId).toBe(MOCK_CLIENT_ID);
    });

    it('rejects token with wrong issuer', async () => {
      const token = makeBearer(basePayload({ iss: 'https://wrong-issuer.example.com' }));
      const result = await validator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toMatch(/Invalid or expired/);
    });

    it('rejects expired token', async () => {
      const token = makeBearer(basePayload({ exp: Math.floor(Date.now() / 1000) - 10 }));
      const result = await validator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toMatch(/Invalid or expired/);
    });

    it('rejects malformed token (no payload segment)', async () => {
      const result = await validator.validate('not-a-jwt');

      expect(result.isErr()).toBe(true);
    });

    it('maps token claims to tableauAuthInfo correctly', async () => {
      const token = makeBearer(basePayload());
      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.type).toBe('Bearer');
      expect(extra.username).toBe('user@example.com');
      expect(extra.siteId).toBe('abc123');
      expect(extra.siteName).toBe('default-site');
      expect(extra.userId).toBe('uid-1');
    });

    it('resolves tableauAuthInfo.userId from the current session when the bearer token claim is absent', async () => {
      const mockSetBearerToken = vi.fn();
      const mockGetCurrentServerSession = vi.fn().mockResolvedValue(
        new Ok({
          site: { id: 'abc123', name: 'site-name' },
          user: { id: 'session-user-id', name: 'user@example.com' },
        }),
      );
      vi.mocked(RestApi).mockImplementationOnce(
        () =>
          ({
            setBearerToken: mockSetBearerToken,
            authenticatedServerMethods: {
              getCurrentServerSession: mockGetCurrentServerSession,
            },
          }) as unknown as RestApi,
      );
      const { 'https://tableau.com/userId': _userId, ...payloadWithoutUserId } = basePayload();
      const token = makeBearer(payloadWithoutUserId);

      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(mockSetBearerToken).toHaveBeenCalledWith(token);
      expect(mockGetCurrentServerSession).toHaveBeenCalledOnce();
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.userId).toBe('session-user-id');
    });

    it('rejects the token when current session userId resolution fails', async () => {
      const mockGetCurrentServerSession = vi
        .fn()
        .mockResolvedValue(new Err({ type: 'unauthorized', message: 'unauthorized' }));
      vi.mocked(RestApi).mockImplementationOnce(
        () =>
          ({
            setBearerToken: vi.fn(),
            authenticatedServerMethods: {
              getCurrentServerSession: mockGetCurrentServerSession,
            },
          }) as unknown as RestApi,
      );
      const { 'https://tableau.com/userId': _userId, ...payloadWithoutUserId } = basePayload();
      const token = makeBearer(payloadWithoutUserId);

      const result = await validator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBe('Invalid or expired access token');
      expect(mockGetCurrentServerSession).toHaveBeenCalledOnce();
    });

    it('resolves tableauAuthInfo.siteName from the current session contentUrl when present', async () => {
      const mockSetBearerToken = vi.fn();
      const mockGetCurrentServerSession = vi.fn().mockResolvedValue(
        new Ok({
          site: { id: 'abc123', name: 'site-name', contentUrl: 'my-site' },
          user: { id: 'uid-1', name: 'user@example.com' },
        }),
      );
      vi.mocked(RestApi).mockImplementationOnce(
        () =>
          ({
            setBearerToken: mockSetBearerToken,
            authenticatedServerMethods: {
              getCurrentServerSession: mockGetCurrentServerSession,
            },
          }) as unknown as RestApi,
      );
      const token = makeBearer(basePayload());

      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(mockSetBearerToken).toHaveBeenCalledWith(token);
      expect(mockGetCurrentServerSession).toHaveBeenCalledOnce();
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.siteName).toBe('my-site');
    });

    it('defaults tableauAuthInfo.siteName to empty string when contentUrl is missing', async () => {
      const mockSetBearerToken = vi.fn();
      const mockGetCurrentServerSession = vi.fn().mockResolvedValue(
        new Ok({
          site: { id: 'abc123', name: 'site-name' },
          user: { id: 'uid-1', name: 'user@example.com' },
        }),
      );
      vi.mocked(RestApi).mockImplementationOnce(
        () =>
          ({
            setBearerToken: mockSetBearerToken,
            authenticatedServerMethods: {
              getCurrentServerSession: mockGetCurrentServerSession,
            },
          }) as unknown as RestApi,
      );
      const token = makeBearer(basePayload());

      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(mockSetBearerToken).toHaveBeenCalledWith(token);
      expect(mockGetCurrentServerSession).toHaveBeenCalledOnce();
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.siteName).toBe('');
    });

    it('defaults tableauAuthInfo.siteName to empty string when contentUrl is empty', async () => {
      const mockSetBearerToken = vi.fn();
      const mockGetCurrentServerSession = vi.fn().mockResolvedValue(
        new Ok({
          site: { id: 'abc123', name: 'site-name', contentUrl: '' },
          user: { id: 'uid-1', name: 'user@example.com' },
        }),
      );
      vi.mocked(RestApi).mockImplementationOnce(
        () =>
          ({
            setBearerToken: mockSetBearerToken,
            authenticatedServerMethods: {
              getCurrentServerSession: mockGetCurrentServerSession,
            },
          }) as unknown as RestApi,
      );
      const token = makeBearer(basePayload());

      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(mockSetBearerToken).toHaveBeenCalledWith(token);
      expect(mockGetCurrentServerSession).toHaveBeenCalledOnce();
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.siteName).toBe('');
    });
  });

  describe('audience validation (RFC 9068)', () => {
    it('accepts a token whose aud matches the pod resource identifier', async () => {
      const token = makeBearer(basePayload({ aud: EXPECTED_AUD }));

      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('rejects a token minted for another deployment (cross-pod)', async () => {
      const token = makeBearer(basePayload({ aud: 'https://other-pod.example.com/tableau-mcp' }));

      const result = await validator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toMatch(/audience/i);
    });

    it('accepts a token whose aud matches the configured global resource URL', async () => {
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', MOCK_GLOBAL_RESOURCE_URI);
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: MOCK_GLOBAL_RESOURCE_URI }));

      const result = await audValidator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('still accepts the pod resource identifier when a global resource URI is configured', async () => {
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', MOCK_GLOBAL_RESOURCE_URI);
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: EXPECTED_AUD }));

      const result = await audValidator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('accepts any aud listed in a comma-separated OAUTH_GLOBAL_RESOURCE_URIS', async () => {
      const secondGlobal = 'https://other-global.example.com';
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', `${MOCK_GLOBAL_RESOURCE_URI}, ${secondGlobal}`);
      const audValidator = new TableauAccessTokenValidator();

      for (const aud of [MOCK_GLOBAL_RESOURCE_URI, secondGlobal, EXPECTED_AUD]) {
        const result = await audValidator.validate(makeBearer(basePayload({ aud })));
        expect(result.isOk()).toBe(true);
      }
    });

    it('accepts an aud that differs from the pod resource identifier only by a trailing slash', async () => {
      const token = makeBearer(basePayload({ aud: `${EXPECTED_AUD}/` }));

      const result = await validator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('accepts an aud that matches a global resource URI minus a trailing slash', async () => {
      // Configured value has no trailing slash; the AS stamps one into the token.
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', MOCK_GLOBAL_RESOURCE_URI);
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: `${MOCK_GLOBAL_RESOURCE_URI}/` }));

      const result = await audValidator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('accepts a token aud without a trailing slash against a global URI configured with one', async () => {
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', `${MOCK_GLOBAL_RESOURCE_URI}/`);
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: MOCK_GLOBAL_RESOURCE_URI }));

      const result = await audValidator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('accepts a loopback aud whose host differs from the resource URI form (localhost vs 127.0.0.1)', async () => {
      // Resource URI configured with the 127.0.0.1 default form; token stamped with the
      // equivalent localhost form (a locally-run server is reached at either).
      vi.stubEnv('OAUTH_RESOURCE_URI', 'http://127.0.0.1:3927');
      const audValidator = new TableauAccessTokenValidator();

      for (const aud of [
        'http://localhost:3927/tableau-mcp',
        'http://127.0.0.1:3927/tableau-mcp',
        'http://[::1]:3927/tableau-mcp',
      ]) {
        const result = await audValidator.validate(makeBearer(basePayload({ aud })));
        expect(result.isOk()).toBe(true);
      }
    });

    it('still rejects a loopback aud on a different port or scheme', async () => {
      vi.stubEnv('OAUTH_RESOURCE_URI', 'http://127.0.0.1:3927');
      const audValidator = new TableauAccessTokenValidator();

      for (const aud of [
        'http://localhost:9999/tableau-mcp', // wrong port
        'https://localhost:3927/tableau-mcp', // wrong scheme
      ]) {
        const result = await audValidator.validate(makeBearer(basePayload({ aud })));
        expect(result.isErr()).toBe(true);
      }
    });

    it('rejects a loopback-form aud when the resource URI is a custom (non-loopback) host', async () => {
      // Default validator from beforeEach is configured with MOCK_RESOURCE_URI
      // ('https://mcp.example.com'), a custom deployment host. Loopback-host canonicalization
      // must not widen matching to accept localhost/127.0.0.1/[::1] against it.
      for (const aud of [
        'http://localhost:3927/tableau-mcp',
        'http://127.0.0.1:3927/tableau-mcp',
        'http://[::1]:3927/tableau-mcp',
      ]) {
        const result = await validator.validate(makeBearer(basePayload({ aud })));
        expect(result.isErr()).toBe(true);
      }
    });

    it('rejects an aud not present in a comma-separated OAUTH_GLOBAL_RESOURCE_URIS', async () => {
      vi.stubEnv(
        'OAUTH_GLOBAL_RESOURCE_URIS',
        `${MOCK_GLOBAL_RESOURCE_URI}, https://other-global.example.com`,
      );
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: 'https://not-listed.example.com' }));

      const result = await audValidator.validate(token);

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toMatch(/audience/i);
    });
  });
});

describe('EmbeddedAccessTokenValidator site binding', () => {
  const ISSUER = 'http://127.0.0.1:3931';
  const SERVER = 'https://10ay.online.tableau.com';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  async function mint(overrides: Record<string, unknown> = {}): Promise<string> {
    const payload = {
      sub: 'viewer-a@example.com',
      clientId: 'client-1',
      tableauServer: SERVER,
      tableauSiteContentUrl: 'site-a',
      tableauSiteId: 'luid-site-a',
      tableauUserId: 'uid-a',
      iat: Math.floor(Date.now() / 1000),
      exp: FUTURE_EXP,
      aud: 'tableau-mcp-server',
      iss: ISSUER,
      scope: 'tableau:mcp:users:read',
      ...overrides,
    };
    return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
      .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
      .encrypt(publicKey);
  }

  function stubServerB({ auth, lockSite }: { auth: string; lockSite: boolean }): void {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('AUTH', auth);
    vi.stubEnv('SERVER', SERVER);
    vi.stubEnv('SITE_NAME', 'site-b');
    vi.stubEnv('OAUTH_ISSUER', ISSUER);
    vi.stubEnv('OAUTH_LOCK_SITE', String(lockSite));
    vi.stubEnv('OAUTH_JWE_PRIVATE_KEY', 'unused');
    vi.stubEnv('UAT_TENANT_ID', 'tenant');
    vi.stubEnv('UAT_ISSUER', 'uat-issuer');
    vi.stubEnv('UAT_USERNAME_CLAIM', 'sub');
    vi.stubEnv('UAT_USERNAME_CLAIM_NAME', 'sub');
    vi.stubEnv('UAT_PRIVATE_KEY', 'key');
    vi.stubEnv('UAT_KEY_ID', 'kid');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe.each([true, false])('AUTH=uat, OAUTH_LOCK_SITE=%s', (lockSite) => {
    beforeEach(() => stubServerB({ auth: 'uat', lockSite }));

    it('rejects a raw bearer minted on Site A when this server is bound to Site B', async () => {
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(await mint());
      expect(result.isErr()).toBe(true);
    });

    it('rejects a bearer with no site claim (minted before site binding)', async () => {
      const token = await mint({ tableauSiteContentUrl: undefined });
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(token);
      expect(result.isErr()).toBe(true);
    });

    it('rejects a targetUrl/tenant mismatch even when the site name matches', async () => {
      const token = await mint({
        tableauSiteContentUrl: 'site-b',
        tableauServer: 'https://10az.online.tableau.com',
      });
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(token);
      expect(result.isErr()).toBe(true);
    });

    it('accepts a bearer minted for Site B on this server', async () => {
      const token = await mint({ tableauSiteContentUrl: 'site-b', tableauSiteId: 'luid-site-b' });
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(token);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.extra).toMatchObject({
        siteName: 'site-b',
        siteId: 'luid-site-b',
        username: 'viewer-a@example.com',
      });
    });
  });

  describe('AUTH=oauth', () => {
    function mockLiveSite(contentUrl: string): void {
      vi.mocked(RestApi).mockImplementationOnce(
        () =>
          ({
            setCredentials: vi.fn(),
            authenticatedServerMethods: {
              getCurrentServerSession: vi.fn().mockResolvedValue(
                new Ok({
                  site: { id: 'x', name: contentUrl, contentUrl },
                  user: { id: 'uid-a' },
                }),
              ),
            },
          }) as unknown as RestApi,
      );
    }

    const oauthToken = (overrides: Record<string, unknown> = {}): Promise<string> =>
      mint({
        tableauAccessToken: 'a|b|luid-site-a|c',
        tableauRefreshToken: 'refresh',
        tableauExpiresAt: FUTURE_EXP,
        ...overrides,
      });

    it('with OAUTH_LOCK_SITE=true rejects a bearer whose live session is on another site', async () => {
      stubServerB({ auth: 'oauth', lockSite: true });
      mockLiveSite('site-a');
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(
        await oauthToken(),
      );
      expect(result.isErr()).toBe(true);
    });

    it('with OAUTH_LOCK_SITE=true accepts a bearer whose live session is on the configured site', async () => {
      stubServerB({ auth: 'oauth', lockSite: true });
      mockLiveSite('site-b');
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(
        await oauthToken(),
      );
      expect(result.isOk()).toBe(true);
    });

    it('with OAUTH_LOCK_SITE=false still accepts the user-chosen site', async () => {
      stubServerB({ auth: 'oauth', lockSite: false });
      mockLiveSite('site-a');
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(
        await oauthToken(),
      );
      expect(result.isOk()).toBe(true);
    });

    it('rejects a different Tableau server regardless of OAUTH_LOCK_SITE', async () => {
      stubServerB({ auth: 'oauth', lockSite: false });
      mockLiveSite('site-b');
      const token = await oauthToken({ tableauServer: 'https://10az.online.tableau.com' });
      const result = await new EmbeddedAccessTokenValidator(privateKey).validate(token);
      expect(result.isErr()).toBe(true);
    });
  });
});

describe('matchAudience', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('OAUTH_RESOURCE_URI', MOCK_RESOURCE_URI);
    vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', MOCK_GLOBAL_RESOURCE_URI);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  it('lists the normalized resource identifier and global resource URIs', () => {
    vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', `${MOCK_GLOBAL_RESOURCE_URI}/`);

    expect(matchAudience({ aud: EXPECTED_AUD, config: getConfig() })).toEqual({
      allowedAudiences: [EXPECTED_AUD, MOCK_GLOBAL_RESOURCE_URI],
      matches: true,
    });
  });

  it.each([
    [[EXPECTED_AUD], true],
    [['https://other.example.com', `${MOCK_GLOBAL_RESOURCE_URI}/`], true],
    [['https://other.example.com', 'my-client-id'], false],
    [[], false],
    ['https://other-pod.example.com/tableau-mcp', false],
  ])('matches aud %j: %s', (aud, matches) => {
    expect(matchAudience({ aud, config: getConfig() }).matches).toBe(matches);
  });
});

describe('ExternalAccessTokenValidator', () => {
  const EXTERNAL_ISSUER = 'https://idp.example.com';
  const EXTERNAL_CLIENT_ID = 'mcp-client';
  const INTROSPECTION_URI = 'https://idp.example.com/introspect';
  const INTROSPECTION_CLIENT_ID = 'mcp-resource-server';
  const INTROSPECTION_SECRET = 'introspection-s3cret';
  const INVALID_TOKEN_ERROR = 'Invalid or expired access token';
  const AUDIENCE_ERROR = 'Token audience does not match this MCP server';
  const now = Math.floor(Date.now() / 1000);
  const tableauAuthInfo = (username: string): Record<string, unknown> => ({
    type: 'X-Tableau-Auth',
    username,
    server: 'https://my-tableau-server.com',
    siteName: 'tc25',
  });

  function withoutUndefined(claims: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(claims).filter(([, value]) => value !== undefined));
  }

  function errorOf(result: Awaited<ReturnType<ExternalAccessTokenValidator['validate']>>): string {
    return result.isErr() ? result.error : 'not an error';
  }

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('AUTH', 'direct-trust');
    vi.stubEnv('JWT_SUB_CLAIM', '{OAUTH_USERNAME}');
    vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'connected-app-client-id');
    vi.stubEnv('CONNECTED_APP_SECRET_ID', 'connected-app-secret-id');
    vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'connected-app-secret-value');
    vi.stubEnv('OAUTH_ISSUER', EXTERNAL_ISSUER);
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');
    vi.stubEnv('OAUTH_RESOURCE_URI', MOCK_RESOURCE_URI);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  describe('JWT access tokens (RFC 9068)', () => {
    let privateKey: CryptoKey;
    let otherPrivateKey: CryptoKey;
    let getKey: JWTVerifyGetKey;

    beforeAll(async () => {
      const keyPair = await generateKeyPair('RS256');
      privateKey = keyPair.privateKey;
      otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
      getKey = createLocalJWKSet({
        keys: [{ ...(await exportJWK(keyPair.publicKey)), alg: 'RS256', kid: 'key-1' }],
      });
    });

    beforeEach(() => {
      vi.stubEnv('OAUTH_EXTERNAL_JWKS_URI', 'https://idp.example.com/keys');
    });

    function rfc9068Claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return withoutUndefined({
        iss: EXTERNAL_ISSUER,
        exp: now + 3600,
        aud: EXPECTED_AUD,
        sub: 'jdoe@example.com',
        client_id: EXTERNAL_CLIENT_ID,
        iat: now,
        jti: 'dbe39bf3a3ba4238a513f51d6e1691c4',
        scope: 'tableau:mcp:datasource:read tableau:mcp:view:read',
        ...overrides,
      });
    }

    async function sign(claims: Record<string, unknown>, key = privateKey): Promise<string> {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'key-1' })
        .sign(key);
    }

    it('maps a verified token to an X-Tableau-Auth identity', async () => {
      const token = await sign(rfc9068Claims());

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(result.unwrap()).toEqual({
        token,
        clientId: EXTERNAL_CLIENT_ID,
        scopes: ['tableau:mcp:datasource:read', 'tableau:mcp:view:read'],
        expiresAt: now + 3600,
        extra: tableauAuthInfo('jdoe@example.com'),
      });
    });

    it('reads scp array scopes, azp, an aud array, and a custom username claim', async () => {
      vi.stubEnv('OAUTH_EXTERNAL_USERNAME_CLAIM_NAME', 'tableau_username');
      const token = await sign(
        rfc9068Claims({
          aud: ['https://other.example.com', EXPECTED_AUD],
          azp: 'azp-client',
          client_id: undefined,
          scope: undefined,
          scp: ['tableau:mcp:datasource:read', 'tableau:mcp:view:read'],
          tableau_username: 'jdoe',
        }),
      );

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(result.unwrap()).toMatchObject({
        clientId: 'azp-client',
        scopes: ['tableau:mcp:datasource:read', 'tableau:mcp:view:read'],
        extra: tableauAuthInfo('jdoe'),
      });
    });

    it('rejects a token signed by another key', async () => {
      const token = await sign(rfc9068Claims(), otherPrivateKey);

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it('rejects a token with a forged signature without trusting its claims', async () => {
      const result = await new ExternalAccessTokenValidator({ getKey }).validate(
        makeBearer(rfc9068Claims()),
      );

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it.each<[string, Record<string, unknown>]>([
      ['iss is wrong', { iss: 'https://evil.example.com' }],
      ['exp has passed', { exp: now - 60 }],
      ['exp is missing', { exp: undefined }],
      ['the username claim is missing', { sub: undefined }],
      ['the username claim is blank', { sub: '   ' }],
      ['the username claim has a control character', { sub: 'jdoe\nadmin' }],
    ])('rejects the token when %s', async (_, overrides) => {
      const token = await sign(rfc9068Claims(overrides));

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it.each([
      ['another resource', 'https://other-pod.example.com/tableau-mcp'],
      ['the client ID', EXTERNAL_CLIENT_ID],
    ])('rejects the token when aud is %s', async (_, aud) => {
      const token = await sign(rfc9068Claims({ aud }));

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(AUDIENCE_ERROR);
    });
  });

  describe('token introspection (RFC 7662)', () => {
    const OPAQUE_TOKEN = '2YotnFZFEjr1zCsicMWpAA';

    beforeEach(() => {
      vi.stubEnv('OAUTH_EXTERNAL_INTROSPECTION_URI', INTROSPECTION_URI);
      vi.stubEnv('OAUTH_EXTERNAL_INTROSPECTION_CLIENT_ID', INTROSPECTION_CLIENT_ID);
      vi.stubEnv('OAUTH_EXTERNAL_INTROSPECTION_CLIENT_SECRET', INTROSPECTION_SECRET);
    });

    // The RFC 7662 section 2.2 example response, with aud, iss, and exp set for this server.
    function rfc7662Response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return withoutUndefined({
        active: true,
        client_id: 'l238j323ds-23ij4',
        username: 'jdoe',
        scope: 'read write dolphin',
        sub: 'Z5O3upPC88QrAjx00dis',
        aud: EXPECTED_AUD,
        iss: EXTERNAL_ISSUER,
        exp: FUTURE_EXP,
        iat: 1419350238,
        extension_field: 'twenty-seven',
        ...overrides,
      });
    }

    function mockFetch(
      body: unknown,
      status = 200,
    ): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
      return vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    it('maps an active introspection response to an X-Tableau-Auth identity', async () => {
      const fetch = mockFetch(rfc7662Response());

      const result = await new ExternalAccessTokenValidator({ fetch }).validate(OPAQUE_TOKEN);

      expect(result.unwrap()).toEqual({
        token: OPAQUE_TOKEN,
        clientId: 'l238j323ds-23ij4',
        scopes: ['read', 'write', 'dolphin'],
        expiresAt: FUTURE_EXP,
        extra: tableauAuthInfo('Z5O3upPC88QrAjx00dis'),
      });
      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(INTROSPECTION_URI);
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Basic ${Buffer.from(`${INTROSPECTION_CLIENT_ID}:${INTROSPECTION_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(String(init?.body)).toBe(`token=${OPAQUE_TOKEN}&token_type_hint=access_token`);
    });

    it('form-encodes the client credentials in the Basic header', async () => {
      vi.stubEnv('OAUTH_EXTERNAL_INTROSPECTION_CLIENT_SECRET', 'p@ss:word');
      const fetch = mockFetch(rfc7662Response());

      await new ExternalAccessTokenValidator({ fetch }).validate(OPAQUE_TOKEN);

      expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from(`${INTROSPECTION_CLIENT_ID}:p%40ss%3Aword`).toString('base64')}`,
      });
    });

    it.each<[string, unknown]>([
      ['active is false', { active: false }],
      ['active is missing', rfc7662Response({ active: undefined })],
      ['iss does not match', rfc7662Response({ iss: 'https://evil.example.com' })],
      ['exp has passed', rfc7662Response({ exp: now - 60 })],
      ['token_type is a refresh token', rfc7662Response({ token_type: 'refresh_token' })],
    ])('rejects the token when %s', async (_, body) => {
      const result = await new ExternalAccessTokenValidator({ fetch: mockFetch(body) }).validate(
        OPAQUE_TOKEN,
      );

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it.each([
      ['aud is missing', rfc7662Response({ aud: undefined })],
      ['aud is another resource', rfc7662Response({ aud: 'https://other.example.com' })],
    ])('rejects the token when %s', async (_, body) => {
      const result = await new ExternalAccessTokenValidator({ fetch: mockFetch(body) }).validate(
        OPAQUE_TOKEN,
      );

      expect(errorOf(result)).toBe(AUDIENCE_ERROR);
    });

    it('rejects the token when the introspection endpoint returns a non-2xx status', async () => {
      const fetch = mockFetch(rfc7662Response(), 401);

      const result = await new ExternalAccessTokenValidator({ fetch }).validate(OPAQUE_TOKEN);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it('rejects the token when the introspection request fails', async () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValue(new TypeError('fetch failed'));

      const result = await new ExternalAccessTokenValidator({ fetch }).validate(OPAQUE_TOKEN);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
      expect(fetch).toHaveBeenCalledOnce();
    });

    it('never logs the token, the client secret, or the response body', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const echoedBody = { error: OPAQUE_TOKEN, error_description: INTROSPECTION_SECRET };

      await new ExternalAccessTokenValidator({ fetch: mockFetch(echoedBody, 400) }).validate(
        OPAQUE_TOKEN,
      );
      await new ExternalAccessTokenValidator({
        fetch: mockFetch(rfc7662Response({ aud: 'https://other.example.com' })),
      }).validate(OPAQUE_TOKEN);
      await new ExternalAccessTokenValidator({
        fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('fetch failed')),
      }).validate(OPAQUE_TOKEN);
      // JSON.parse errors quote the first 10 characters of a body that starts with a letter.
      const leakCheckToken = 'opaque-token-leak-check';
      await new ExternalAccessTokenValidator({
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(new Response(`${leakCheckToken} ${INTROSPECTION_SECRET}`)),
      }).validate(leakCheckToken);

      const output = [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].flat().map(String).join();
      expect(output).toContain('External access token rejected');
      expect(output).toContain('Access token audience mismatch');
      expect(output).toContain('introspection response is not valid JSON');
      expect(output).not.toContain(OPAQUE_TOKEN);
      expect(output).not.toContain(leakCheckToken.slice(0, 10));
      expect(output).not.toContain(INTROSPECTION_SECRET);
      expect(output).not.toContain(
        Buffer.from(`${INTROSPECTION_CLIENT_ID}:${INTROSPECTION_SECRET}`).toString('base64'),
      );
    });
  });
});
