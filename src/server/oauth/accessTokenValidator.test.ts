import { Err, Ok } from 'ts-results-es';

import { RestApi } from '../../sdks/tableau/restApi.js';
import { TableauAccessTokenValidator } from './accessTokenValidator.js';

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
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URI', MOCK_GLOBAL_RESOURCE_URI);
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: MOCK_GLOBAL_RESOURCE_URI }));

      const result = await audValidator.validate(token);

      expect(result.isOk()).toBe(true);
    });

    it('still accepts the pod resource identifier when a global resource URI is configured', async () => {
      vi.stubEnv('OAUTH_GLOBAL_RESOURCE_URI', MOCK_GLOBAL_RESOURCE_URI);
      const audValidator = new TableauAccessTokenValidator();
      const token = makeBearer(basePayload({ aud: EXPECTED_AUD }));

      const result = await audValidator.validate(token);

      expect(result.isOk()).toBe(true);
    });
  });
});
