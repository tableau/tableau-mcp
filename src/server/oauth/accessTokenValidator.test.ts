import { generateKeyPairSync } from 'crypto';
import { CompactEncrypt } from 'jose';
import { Err, Ok } from 'ts-results-es';

import { RestApi } from '../../sdks/tableau/restApi.js';
import {
  EmbeddedAccessTokenValidator,
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
