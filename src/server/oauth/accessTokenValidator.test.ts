import { generateKeyPairSync } from 'crypto';
import {
  CompactEncrypt,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  JSONWebKeySet,
  JWTVerifyGetKey,
  SignJWT,
  UnsecuredJWT,
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

  it.each([
    ['my-client-id', true],
    ['my-client-id-2', false],
  ])('matches a client ID global resource value exactly (aud %j: %s)', (aud, matches) => {
    vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', 'my-client-id');

    expect(matchAudience({ aud, config: getConfig() }).matches).toBe(matches);
  });
});

describe('ExternalAccessTokenValidator', () => {
  const EXTERNAL_ISSUER = 'https://idp.example.com';
  const EXTERNAL_CLIENT_ID = 'mcp-client';
  const INVALID_TOKEN_ERROR = 'Invalid or expired access token';
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

  function captureLogs(): () => string[] {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return () => [...consoleSpy.mock.calls, ...stderrSpy.mock.calls].flat().map(String);
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
      vi.stubEnv('OAUTH_EXTERNAL_DISCOVERY', 'true');
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
      ['iat is missing', { iat: undefined }],
      ['iat is not a number', { iat: 'yesterday' }],
      ['aud is missing', { aud: undefined }],
      ['sub is not a string', { sub: 42 }],
      ['sub is empty', { sub: '' }],
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

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it.each([undefined, ''])(
      'rejects a token with sub %j even when the custom username claim is present',
      async (sub) => {
        vi.stubEnv('OAUTH_EXTERNAL_USERNAME_CLAIM_NAME', 'tableau_username');
        const token = await sign(rfc9068Claims({ sub, tableau_username: 'jdoe' }));

        const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

        expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
      },
    );

    it('rejects an HS256 token even if the key resolver returns a shared secret', async () => {
      const secret = new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes');
      const token = await new SignJWT(rfc9068Claims())
        .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
        .sign(secret);
      const getSecret: JWTVerifyGetKey = async () => secret;

      const result = await new ExternalAccessTokenValidator({ getKey: getSecret }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it('rejects an unsigned token (alg none)', async () => {
      const token = new UnsecuredJWT(rfc9068Claims()).encode();

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it.each(['ES256', 'PS256', 'EdDSA'])('accepts a token signed with %s', async (alg) => {
      const keyPair = await generateKeyPair(alg);
      const algGetKey = createLocalJWKSet({
        keys: [{ ...(await exportJWK(keyPair.publicKey)), alg, kid: 'alg-key' }],
      });
      const token = await new SignJWT(rfc9068Claims())
        .setProtectedHeader({ alg, typ: 'at+jwt', kid: 'alg-key' })
        .sign(keyPair.privateKey);

      const result = await new ExternalAccessTokenValidator({ getKey: algGetKey }).validate(token);

      expect(result.isOk()).toBe(true);
    });

    describe('clock skew', () => {
      const FIXED_NOW = 1_800_000_000;

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(FIXED_NOW * 1000);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each<[string, Record<string, unknown>, boolean]>([
        ['exp passed 3 s ago', { exp: FIXED_NOW - 3 }, true],
        ['exp passed 6 s ago', { exp: FIXED_NOW - 6 }, false],
        ['nbf is 3 s ahead', { nbf: FIXED_NOW + 3 }, true],
        ['nbf is 6 s ahead', { nbf: FIXED_NOW + 6 }, false],
      ])('when %s, accepts the token: %s', async (_, overrides, accepted) => {
        const token = await sign(
          rfc9068Claims({ iat: FIXED_NOW, exp: FIXED_NOW + 3600, ...overrides }),
        );

        const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

        expect(result.isOk()).toBe(accepted);
      });
    });

    it('writes one audit record per rejection, even at LOG_LEVEL=emergency, without the token', async () => {
      vi.stubEnv('LOG_LEVEL', 'emergency');
      const capturedLines = captureLogs();
      const tokens = [
        await sign(rfc9068Claims({ aud: 'https://other-pod.example.com/tableau-mcp' })),
        await sign(rfc9068Claims(), otherPrivateKey),
      ];

      for (const token of tokens) {
        await new ExternalAccessTokenValidator({ getKey }).validate(token);
      }

      const lines = capturedLines();
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({
          logger: 'audit',
          message: 'external-token-rejected',
          data: { reason: expect.stringContaining('audience mismatch') },
        }),
        expect.objectContaining({
          logger: 'audit',
          message: 'external-token-rejected',
          data: { reason: expect.any(String) },
        }),
      ]);
      const output = lines.join();
      for (const token of tokens) {
        const [, payload, signature] = token.split('.');
        expect(output).not.toContain(token);
        expect(output).not.toContain(payload);
        expect(output).not.toContain(signature);
      }
    });

    it('truncates a long rejection reason built from the token header', async () => {
      vi.stubEnv('LOG_LEVEL', 'emergency');
      const capturedLines = captureLogs();
      const encode = (value: unknown): string =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      // jose quotes unknown crit names in its error before it resolves a key.
      const header = { alg: 'RS256', kid: 'key-1', crit: ['x'.repeat(400)] };
      const token = `${encode(header)}.${encode(rfc9068Claims())}.c2lnbmF0dXJl`;

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
      const reasons = capturedLines().map((line) => JSON.parse(line).data.reason);
      expect(reasons).toEqual([expect.stringMatching(/\.\.\. \(truncated\)$/)]);
      expect(reasons[0].length).toBeLessThanOrEqual(256 + '... (truncated)'.length);
    });
  });

  describe('OIDC ID tokens', () => {
    const OWN_CLIENT_ID = 'tableau-mcp-client';
    let privateKey: CryptoKey;
    let getKey: JWTVerifyGetKey;

    beforeAll(async () => {
      const keyPair = await generateKeyPair('RS256');
      privateKey = keyPair.privateKey;
      getKey = createLocalJWKSet({
        keys: [{ ...(await exportJWK(keyPair.publicKey)), alg: 'RS256', kid: 'id-key-1' }],
      });
    });

    beforeEach(() => {
      vi.stubEnv('OAUTH_EXTERNAL_DISCOVERY', 'true');
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', OWN_CLIENT_ID);
      vi.stubEnv('OAUTH_DISABLE_SCOPES', 'true');
      vi.stubEnv('OAUTH_EXTERNAL_USERNAME_CLAIM_NAME', 'employee_id');
    });

    function idTokenClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return withoutUndefined({
        iss: EXTERNAL_ISSUER,
        sub: 'u-7f3a9c2e-opaque',
        aud: OWN_CLIENT_ID,
        iat: now,
        exp: now + 3600,
        auth_time: now - 30,
        nonce: 'n-0S6_WzA2Mj',
        employee_id: '1234567',
        ...overrides,
      });
    }

    async function signIdToken(claims: Record<string, unknown>): Promise<string> {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'id-key-1' })
        .sign(privateKey);
    }

    it("accepts an ID token whose aud is this server's own client ID", async () => {
      const token = await signIdToken(idTokenClaims());

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(result.unwrap()).toEqual({
        token,
        clientId: '',
        scopes: [],
        expiresAt: now + 3600,
        extra: tableauAuthInfo('1234567'),
      });
    });

    it('uses a numeric username claim as its decimal string', async () => {
      const token = await signIdToken(idTokenClaims({ employee_id: 1234567 }));

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(result.unwrap().extra).toEqual(tableauAuthInfo('1234567'));
    });

    it.each<[string, unknown]>([
      ['a fraction', 1.5],
      ['an unsafe integer', 2 ** 53],
      ['negative', -1],
      ['a boolean', true],
      ['an array', ['1234567']],
      ['an object', {}],
      ['empty', ''],
    ])('rejects the token when the username claim is %s', async (_, employeeId) => {
      const token = await signIdToken(idTokenClaims({ employee_id: employeeId }));

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it('rejects an ID token for another client', async () => {
      const token = await signIdToken(idTokenClaims({ aud: 'other-client' }));

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });

    it('rejects an ID token without iat', async () => {
      const token = await signIdToken(idTokenClaims({ iat: undefined }));

      const result = await new ExternalAccessTokenValidator({ getKey }).validate(token);

      expect(errorOf(result)).toBe(INVALID_TOKEN_ERROR);
    });
  });

  describe('OpenID Connect discovery', () => {
    const OWN_CLIENT_ID = 'tableau-mcp-client';
    const DISCOVERY_URL = `${EXTERNAL_ISSUER}/.well-known/openid-configuration`;
    // Another origin than the issuer, as with Google (accounts.google.com -> www.googleapis.com).
    const JWKS_URI = 'https://keys.idp-cdn.example.com/oauth2/v3/certs';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let jwks: JSONWebKeySet;

    beforeAll(async () => {
      // No alg on the JWK, so the same RSA key can verify RS256 and PS256.
      jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'disc-key-1', use: 'sig' }] };
    });

    beforeEach(() => {
      vi.stubEnv('OAUTH_EXTERNAL_DISCOVERY', 'true');
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URIS', OWN_CLIENT_ID);
      vi.stubEnv('OAUTH_DISABLE_SCOPES', 'true');
      vi.stubEnv('OAUTH_EXTERNAL_USERNAME_CLAIM_NAME', 'employee_id');
    });

    function openIdConfiguration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return withoutUndefined({
        issuer: EXTERNAL_ISSUER,
        authorization_endpoint: `${EXTERNAL_ISSUER}/authorize`,
        token_endpoint: `${EXTERNAL_ISSUER}/token`,
        jwks_uri: JWKS_URI,
        response_types_supported: ['code', 'id_token'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        ...overrides,
      });
    }

    function jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    function discoveryFetch(
      document: Record<string, unknown> = openIdConfiguration(),
      discoveryUrl = DISCOVERY_URL,
    ): ReturnType<typeof vi.fn<typeof globalThis.fetch>> {
      return vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url === discoveryUrl) {
          return jsonResponse(document);
        }
        if (url === document.jwks_uri) {
          return jsonResponse(jwks);
        }
        return new Response('Not Found', { status: 404 });
      });
    }

    function fetchedUrls(fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>): string[] {
      return fetch.mock.calls.map(([url]) => String(url));
    }

    function idTokenClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return withoutUndefined({
        iss: EXTERNAL_ISSUER,
        sub: 'u-7f3a9c2e-opaque',
        aud: OWN_CLIENT_ID,
        iat: now,
        exp: now + 3600,
        auth_time: now - 30,
        nonce: 'n-0S6_WzA2Mj',
        employee_id: '1234567',
        ...overrides,
      });
    }

    async function signIdToken({
      alg = 'RS256',
      claims = idTokenClaims(),
    }: { alg?: string; claims?: Record<string, unknown> } = {}): Promise<string> {
      return new SignJWT(claims)
        .setProtectedHeader({ alg, typ: 'JWT', kid: 'disc-key-1' })
        .sign(privateKey);
    }

    async function rejectionReasons(
      validator: ExternalAccessTokenValidator,
      token: string,
    ): Promise<string[]> {
      vi.stubEnv('LOG_LEVEL', 'emergency');
      const capturedLines = captureLogs();

      expect(errorOf(await validator.validate(token))).toBe(INVALID_TOKEN_ERROR);

      return capturedLines().map((line) => JSON.parse(line).data.reason);
    }

    it('reads the document, then its JWKS, and accepts a valid ID token', async () => {
      const fetch = discoveryFetch();
      const token = await signIdToken();

      const result = await new ExternalAccessTokenValidator({ fetch }).validate(token);

      expect(result.unwrap()).toEqual({
        token,
        clientId: '',
        scopes: [],
        expiresAt: now + 3600,
        extra: tableauAuthInfo('1234567'),
      });
      expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL, JWKS_URI]);
      const [, init] = fetch.mock.calls[0];
      expect(init).toMatchObject({ redirect: 'error', headers: { Accept: 'application/json' } });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('reads the document once per validator', async () => {
      const fetch = discoveryFetch();
      const validator = new ExternalAccessTokenValidator({ fetch });
      const token = await signIdToken();

      expect((await validator.validate(token)).isOk()).toBe(true);
      expect((await validator.validate(token)).isOk()).toBe(true);

      expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL, JWKS_URI]);
    });

    it('makes one document request for concurrent first validations', async () => {
      const fetch = discoveryFetch();
      const validator = new ExternalAccessTokenValidator({ fetch });
      const token = await signIdToken();

      const results = await Promise.all([validator.validate(token), validator.validate(token)]);

      expect(results.map((result) => result.isOk())).toEqual([true, true]);
      expect(fetchedUrls(fetch).filter((url) => url === DISCOVERY_URL)).toHaveLength(1);
    });

    it('reads the document for an issuer with a trailing slash', async () => {
      const issuer = `${EXTERNAL_ISSUER}/`;
      vi.stubEnv('OAUTH_ISSUER', issuer);
      const fetch = discoveryFetch(openIdConfiguration({ issuer }));
      const token = await signIdToken({ claims: idTokenClaims({ iss: issuer }) });

      const result = await new ExternalAccessTokenValidator({ fetch }).validate(token);

      expect(result.isOk()).toBe(true);
      expect(fetchedUrls(fetch)[0]).toBe(DISCOVERY_URL);
    });

    it.each([
      ['another issuer', 'https://evil.example.com'],
      ['the issuer with an added trailing slash', `${EXTERNAL_ISSUER}/`],
    ])('rejects the token when the document issuer is %s', async (_, issuer) => {
      const fetch = discoveryFetch(openIdConfiguration({ issuer }));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, await signIdToken());

      expect(reasons).toEqual([`discovery failed: issuer mismatch: got '${issuer}'`]);
      expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL]);
    });

    it.each([
      [
        'http://keys.idp-cdn.example.com/certs',
        "jwks_uri must use https unless it and the issuer are both loopback: 'http://keys.idp-cdn.example.com/certs'",
      ],
      ['not a url', 'jwks_uri is not a valid URL'],
    ])('rejects the token when jwks_uri is %s', async (jwksUri, reason) => {
      const fetch = discoveryFetch(openIdConfiguration({ jwks_uri: jwksUri }));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, await signIdToken());

      expect(reasons).toEqual([`discovery failed: ${reason}`]);
      expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL]);
    });

    it('accepts an http jwks_uri on a loopback host when the issuer is loopback', async () => {
      const issuer = 'http://127.0.0.1:8080/realms/mcp';
      const jwksUri = 'http://127.0.0.1:8080/realms/mcp/certs';
      vi.stubEnv('OAUTH_ISSUER', issuer);
      const fetch = discoveryFetch(
        openIdConfiguration({ issuer, jwks_uri: jwksUri }),
        `${issuer}/.well-known/openid-configuration`,
      );

      const result = await new ExternalAccessTokenValidator({ fetch }).validate(
        await signIdToken({ claims: idTokenClaims({ iss: issuer }) }),
      );

      expect(result.isOk()).toBe(true);
      expect(fetchedUrls(fetch)).toEqual([`${issuer}/.well-known/openid-configuration`, jwksUri]);
    });

    it('rejects an http jwks_uri on a remote host from a loopback issuer', async () => {
      const issuer = 'http://127.0.0.1:8080/realms/mcp';
      const jwksUri = 'http://keys.idp-cdn.example.com/certs';
      const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
      vi.stubEnv('OAUTH_ISSUER', issuer);
      const fetch = discoveryFetch(
        openIdConfiguration({ issuer, jwks_uri: jwksUri }),
        discoveryUrl,
      );
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(
        validator,
        await signIdToken({ claims: idTokenClaims({ iss: issuer }) }),
      );

      expect(reasons).toEqual([
        `discovery failed: jwks_uri must use https unless it and the issuer are both loopback: '${jwksUri}'`,
      ]);
      expect(fetchedUrls(fetch)).toEqual([discoveryUrl]);
    });

    it('rejects an http loopback jwks_uri from a remote issuer', async () => {
      const jwksUri = 'http://127.0.0.1:8080/jwks';
      const fetch = discoveryFetch(openIdConfiguration({ jwks_uri: jwksUri }));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, await signIdToken());

      expect(reasons).toEqual([
        `discovery failed: jwks_uri must use https unless it and the issuer are both loopback: '${jwksUri}'`,
      ]);
      expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL]);
    });

    it.each<[string, Record<string, unknown>, string]>([
      [
        'issuer is missing',
        openIdConfiguration({ issuer: undefined }),
        'Validation error: Required at "issuer"',
      ],
      [
        'jwks_uri is missing',
        openIdConfiguration({ jwks_uri: undefined }),
        'Validation error: Required at "jwks_uri"',
      ],
    ])('rejects the token when the document %s', async (_, document, validationError) => {
      const validator = new ExternalAccessTokenValidator({ fetch: discoveryFetch(document) });

      const reasons = await rejectionReasons(validator, await signIdToken());

      expect(reasons).toEqual([
        `discovery failed: invalid openid-configuration: ${validationError}`,
      ]);
    });

    it.each<[string, () => Promise<Response>]>([
      ['returns HTTP 404', async () => new Response('Not Found', { status: 404 })],
      ['is not valid JSON', async () => new Response('<html>maintenance</html>')],
      [
        'request fails',
        async () => {
          throw new TypeError('fetch failed');
        },
      ],
    ])(
      'rejects the token when the document %s, and retries on the next request',
      async (_, failure) => {
        const fetch = discoveryFetch();
        fetch.mockImplementationOnce(failure);
        const validator = new ExternalAccessTokenValidator({ fetch });
        const token = await signIdToken();

        expect(errorOf(await validator.validate(token))).toBe(INVALID_TOKEN_ERROR);
        expect((await validator.validate(token)).isOk()).toBe(true);

        expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL, DISCOVERY_URL, JWKS_URI]);
      },
    );

    it('accepts access and ID tokens signed with an algorithm the document does not list', async () => {
      const fetch = discoveryFetch(
        openIdConfiguration({ id_token_signing_alg_values_supported: ['RS256'] }),
      );
      const validator = new ExternalAccessTokenValidator({ fetch });
      // RFC 9068 access token: the document's id_token_* field does not govern it.
      const accessToken = await new SignJWT(
        idTokenClaims({ client_id: 'some-client', jti: 'a-1', scope: 'openid' }),
      )
        .setProtectedHeader({ alg: 'PS256', typ: 'at+jwt', kid: 'disc-key-1' })
        .sign(privateKey);

      expect((await validator.validate(accessToken)).isOk()).toBe(true);
      expect((await validator.validate(await signIdToken({ alg: 'PS256' }))).isOk()).toBe(true);
    });

    it('accepts an RS256 token when the document lists only symmetric algorithms', async () => {
      const validator = new ExternalAccessTokenValidator({
        fetch: discoveryFetch(
          openIdConfiguration({ id_token_signing_alg_values_supported: ['HS256'] }),
        ),
      });

      expect((await validator.validate(await signIdToken())).isOk()).toBe(true);
    });

    it('rejects an HS256 token even when the document lists HS256', async () => {
      const fetch = discoveryFetch(
        openIdConfiguration({ id_token_signing_alg_values_supported: ['HS256', 'RS256'] }),
      );
      const token = await new SignJWT(idTokenClaims())
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes'));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, token);

      // jose's allowlist message, not its JWKS resolver's, and no JWKS fetch.
      expect(reasons).toEqual(['"alg" (Algorithm) Header Parameter value not allowed']);
      expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL]);
    });

    it('rejects a bearer that is not a JWT without reading the document', async () => {
      const fetch = discoveryFetch();
      fetch.mockResolvedValue(new Response('Not Found', { status: 404 }));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, '2YotnFZFEjr1zCsicMWpAA');

      expect(reasons).toEqual(['Invalid Token or Protected Header formatting']);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fetches the JWKS again for an unknown kid, at most once per cooldown', async () => {
      const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const rotated: JSONWebKeySet = {
        keys: [
          ...jwks.keys,
          { ...(await exportJWK(second.publicKey)), kid: 'disc-key-2', use: 'sig' },
        ],
      };
      let served = jwks;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url === DISCOVERY_URL) {
          return jsonResponse(openIdConfiguration());
        }
        return url === JWKS_URI ? jsonResponse(served) : new Response('', { status: 404 });
      });
      const validator = new ExternalAccessTokenValidator({ fetch });
      const rotatedToken = await new SignJWT(idTokenClaims())
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'disc-key-2' })
        .sign(second.privateKey);

      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        expect((await validator.validate(await signIdToken())).isOk()).toBe(true);

        served = rotated;
        expect(errorOf(await validator.validate(rotatedToken))).toBe(INVALID_TOKEN_ERROR);
        expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL, JWKS_URI]);

        vi.setSystemTime(Date.now() + 31_000);
        expect((await validator.validate(rotatedToken)).isOk()).toBe(true);
        expect(fetchedUrls(fetch)).toEqual([DISCOVERY_URL, JWKS_URI, JWKS_URI]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips discovery when a key resolver is injected', async () => {
      const fetch = discoveryFetch();

      const result = await new ExternalAccessTokenValidator({
        fetch,
        getKey: createLocalJWKSet(jwks),
      }).validate(await signIdToken());

      expect(result.isOk()).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('truncates a long discovery failure reason', async () => {
      const message = `fetch failed: ${'x'.repeat(300)}`;
      const fetch = discoveryFetch();
      fetch.mockRejectedValueOnce(new TypeError(message));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, await signIdToken());

      expect(reasons).toEqual([`discovery failed: ${message.slice(0, 256)}... (truncated)`]);
    });

    it('never logs the document body', async () => {
      const leakCheck = 'leak-check-body';
      const fetch = discoveryFetch();
      fetch.mockResolvedValueOnce(new Response(`${leakCheck} not json`));
      const validator = new ExternalAccessTokenValidator({ fetch });

      const reasons = await rejectionReasons(validator, await signIdToken());

      expect(reasons).toEqual(['discovery failed: openid-configuration is not valid JSON']);
      expect(reasons.join()).not.toContain(leakCheck.slice(0, 10));
    });
  });
});
