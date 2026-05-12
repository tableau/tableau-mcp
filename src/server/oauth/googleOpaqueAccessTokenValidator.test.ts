import { GoogleOpaqueAccessTokenValidator } from './accessTokenValidator.js';
import { GoogleTokenInfoClient, TokenInfoResponse } from './googleTokenInfoClient.js';

const MOCK_AUDIENCE = '843584980601-test.apps.googleusercontent.com';
const MOCK_SERVER = 'https://my-tableau.example.com';
const MOCK_EMAIL = 'martin@bragg.group';

function makeTokenInfoResponse(overrides: Partial<TokenInfoResponse> = {}): TokenInfoResponse {
  return {
    aud: MOCK_AUDIENCE,
    email: MOCK_EMAIL,
    email_verified: true,
    expires_in: 3600,
    hd: 'bragg.group',
    ...overrides,
  };
}

function stubEnvForOidcPassthrough(overrides: Record<string, string> = {}): void {
  vi.stubEnv('AUTH', 'oidc-passthrough');
  vi.stubEnv('SERVER', MOCK_SERVER);
  vi.stubEnv('OIDC_EXPECTED_AUDIENCE', MOCK_AUDIENCE);
  vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'client-123');
  vi.stubEnv('CONNECTED_APP_SECRET_ID', 'secret-123');
  vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'fake-secret-value');
  vi.stubEnv('TABLEAU_MCP_TEST', 'true');
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
}

describe('GoogleOpaqueAccessTokenValidator', () => {
  let mockClient: GoogleTokenInfoClient;
  let validator: GoogleOpaqueAccessTokenValidator;

  beforeEach(() => {
    stubEnvForOidcPassthrough();
    mockClient = {
      validate: vi.fn(),
    } as unknown as GoogleTokenInfoClient;
    validator = new GoogleOpaqueAccessTokenValidator(mockClient);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('happy path', () => {
    it('validates a Google access token and returns AuthInfo with username', async () => {
      vi.mocked(mockClient.validate).mockResolvedValue(makeTokenInfoResponse());

      const result = await validator.validate('ya29.valid-token');

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.clientId).toBe(MOCK_AUDIENCE);
      expect(result.value.token).toBe('ya29.valid-token');

      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.type).toBe('X-Tableau-Auth');
      expect(extra.username).toBe(MOCK_EMAIL);
      expect(extra.server).toBe(MOCK_SERVER);
    });

    it('sets expiresAt based on expires_in from tokeninfo', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      vi.mocked(mockClient.validate).mockResolvedValue(makeTokenInfoResponse({ expires_in: 1800 }));

      const result = await validator.validate('ya29.token');

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      // Should be approximately now + 1800 seconds
      expect(result.value.expiresAt).toBeGreaterThanOrEqual(nowSec + 1799);
      expect(result.value.expiresAt).toBeLessThanOrEqual(nowSec + 1801);
    });
  });

  describe('audience validation', () => {
    it('rejects token with wrong audience', async () => {
      vi.mocked(mockClient.validate).mockResolvedValue(
        makeTokenInfoResponse({ aud: 'wrong-audience.apps.googleusercontent.com' }),
      );

      const result = await validator.validate('ya29.wrong-aud');

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBe('Token audience mismatch');
    });

    it('accepts token when aud matches one of multiple expected audiences', async () => {
      vi.unstubAllEnvs();
      stubEnvForOidcPassthrough({
        OIDC_EXPECTED_AUDIENCE: `${MOCK_AUDIENCE},other-client.apps.googleusercontent.com`,
      });
      const multiAudValidator = new GoogleOpaqueAccessTokenValidator(mockClient);

      vi.mocked(mockClient.validate).mockResolvedValue(makeTokenInfoResponse());

      const result = await multiAudValidator.validate('ya29.multi-aud');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('hd (hosted domain) validation', () => {
    it('rejects token with wrong hd when OIDC_EXPECTED_HD is set', async () => {
      vi.unstubAllEnvs();
      stubEnvForOidcPassthrough({ OIDC_EXPECTED_HD: 'bragg.group' });
      const hdValidator = new GoogleOpaqueAccessTokenValidator(mockClient);

      vi.mocked(mockClient.validate).mockResolvedValue(
        makeTokenInfoResponse({ hd: 'other-domain.com' }),
      );

      const result = await hdValidator.validate('ya29.wrong-hd');

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBe('hd mismatch');
    });

    it('rejects token with missing hd when OIDC_EXPECTED_HD is set', async () => {
      vi.unstubAllEnvs();
      stubEnvForOidcPassthrough({ OIDC_EXPECTED_HD: 'bragg.group' });
      const hdValidator = new GoogleOpaqueAccessTokenValidator(mockClient);

      vi.mocked(mockClient.validate).mockResolvedValue(
        makeTokenInfoResponse({ hd: undefined }),
      );

      const result = await hdValidator.validate('ya29.no-hd');

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBe('hd mismatch');
    });

    it('skips hd check when OIDC_EXPECTED_HD is not set', async () => {
      vi.mocked(mockClient.validate).mockResolvedValue(
        makeTokenInfoResponse({ hd: undefined }),
      );

      const result = await validator.validate('ya29.no-hd-no-check');
      expect(result.isOk()).toBe(true);
    });
  });

  describe('network failure', () => {
    it('returns Err when Google tokeninfo is unreachable', async () => {
      vi.mocked(mockClient.validate).mockRejectedValue(new Error('fetch failed'));

      const result = await validator.validate('ya29.unreachable');

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBe('Invalid or expired access token');
    });
  });

  describe('caching', () => {
    it('returns cached result on second call with same token', async () => {
      vi.mocked(mockClient.validate).mockResolvedValue(makeTokenInfoResponse());

      const result1 = await validator.validate('ya29.cached-token');
      const result2 = await validator.validate('ya29.cached-token');

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      // tokeninfo should only be called once
      expect(mockClient.validate).toHaveBeenCalledTimes(1);
    });

    it('does not cache failed validations', async () => {
      vi.mocked(mockClient.validate).mockRejectedValueOnce(new Error('transient'));
      vi.mocked(mockClient.validate).mockResolvedValueOnce(makeTokenInfoResponse());

      const fail = await validator.validate('ya29.retry-token');
      expect(fail.isErr()).toBe(true);

      const success = await validator.validate('ya29.retry-token');
      expect(success.isOk()).toBe(true);

      expect(mockClient.validate).toHaveBeenCalledTimes(2);
    });
  });

  describe('username mapping', () => {
    it('applies OIDC_USERNAME_MAP_JSON when present', async () => {
      vi.unstubAllEnvs();
      stubEnvForOidcPassthrough({
        OIDC_USERNAME_MAP_JSON: JSON.stringify({ [MOCK_EMAIL]: 'martin.bergamasco' }),
      });
      const mappedValidator = new GoogleOpaqueAccessTokenValidator(mockClient);

      vi.mocked(mockClient.validate).mockResolvedValue(makeTokenInfoResponse());

      const result = await mappedValidator.validate('ya29.mapped');

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.username).toBe('martin.bergamasco');
    });

    it('falls through to email when not in the map', async () => {
      vi.unstubAllEnvs();
      stubEnvForOidcPassthrough({
        OIDC_USERNAME_MAP_JSON: JSON.stringify({ 'other@bragg.group': 'other.user' }),
      });
      const mappedValidator = new GoogleOpaqueAccessTokenValidator(mockClient);

      vi.mocked(mockClient.validate).mockResolvedValue(makeTokenInfoResponse());

      const result = await mappedValidator.validate('ya29.unmapped');

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const extra = result.value.extra as Record<string, unknown>;
      expect(extra.username).toBe(MOCK_EMAIL);
    });
  });
});
