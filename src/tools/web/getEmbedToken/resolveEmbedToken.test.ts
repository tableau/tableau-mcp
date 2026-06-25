import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';

import { EMBED_SCOPE, resolveEmbedToken } from './resolveEmbedToken.js';

const BEARER_JWT = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';

const directTrustConfig = {
  auth: 'direct-trust' as const,
  connectedAppClientId: 'client-id-123',
  connectedAppSecretId: 'secret-id-456',
  connectedAppSecretValue: 'super-secret-value',
  jwtUsername: 'embed-user@example.com',
  uatTenantId: '',
  uatIssuer: '',
  uatUsernameClaimName: '',
  uatPrivateKey: '',
  uatKeyId: '',
};

const bearerAuthInfo = {
  type: 'Bearer' as const,
  raw: BEARER_JWT,
  username: 'bearer-user@example.com',
  server: 'https://example.com',
  siteId: 'site-id',
  siteName: 'site',
};

describe('resolveEmbedToken', () => {
  it('passes through a Tableau Bearer JWT when present', async () => {
    const result = await resolveEmbedToken({
      config: { ...directTrustConfig, auth: 'oauth' },
      tableauAuthInfo: bearerAuthInfo,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().token).toBe(BEARER_JWT);
  });

  it('prefers a present Bearer JWT over signing material', async () => {
    const result = await resolveEmbedToken({
      config: directTrustConfig,
      tableauAuthInfo: bearerAuthInfo,
    });

    expect(result.unwrap().token).toBe(BEARER_JWT);
  });

  it('signs a direct-trust embed JWT with the embed scope and configured sub', async () => {
    const result = await resolveEmbedToken({
      config: directTrustConfig,
      tableauAuthInfo: undefined,
    });

    expect(result.isOk()).toBe(true);
    const payload = decodeJwt(result.unwrap().token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
    expect(payload.iss).toBe('client-id-123');
    expect(payload.aud).toBe('tableau');
  });

  it('also signs for direct-trust when an X-Tableau-Auth authInfo is present (embedded-authz)', async () => {
    const result = await resolveEmbedToken({
      config: directTrustConfig,
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username: 'embed-user@example.com',
        server: 'https://example.com',
        siteName: 'site',
      },
    });

    expect(result.isOk()).toBe(true);
    expect(decodeJwt(result.unwrap().token).scp).toEqual([EMBED_SCOPE]);
  });

  it('returns not-available when no Bearer JWT and no signing material exist', async () => {
    const result = await resolveEmbedToken({
      config: {
        auth: 'pat',
        connectedAppClientId: '',
        connectedAppSecretId: '',
        connectedAppSecretValue: '',
        jwtUsername: '',
        uatTenantId: '',
        uatIssuer: '',
        uatUsernameClaimName: '',
        uatPrivateKey: '',
        uatKeyId: '',
      },
      tableauAuthInfo: undefined,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe('embed-token-not-available');
  });

  it('returns not-available for non-direct-trust auth even with an X-Tableau-Auth authInfo', async () => {
    const result = await resolveEmbedToken({
      config: {
        auth: 'pat',
        connectedAppClientId: '',
        connectedAppSecretId: '',
        connectedAppSecretValue: '',
        jwtUsername: '',
        uatTenantId: '',
        uatIssuer: '',
        uatUsernameClaimName: '',
        uatPrivateKey: '',
        uatKeyId: '',
      },
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username: 'pat-user@example.com',
        server: 'https://example.com',
        siteName: 'site',
      },
    });

    expect(result.isErr()).toBe(true);
  });

  describe('uat embed token', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);

    const uatConfig = {
      auth: 'uat' as const,
      connectedAppClientId: '',
      connectedAppSecretId: '',
      connectedAppSecretValue: '',
      jwtUsername: 'embed-user@example.com',
      uatTenantId: 'test-tenant-id',
      uatIssuer: 'test-issuer',
      uatUsernameClaimName: 'email',
      uatPrivateKey: privateKeyPem,
      uatKeyId: 'test-key-id',
    };

    it('signs a uat embed JWT from the existing UAT key with the embed scope', async () => {
      const result = await resolveEmbedToken({
        config: uatConfig,
        tableauAuthInfo: undefined,
      });

      expect(result.isOk()).toBe(true);
      const payload = decodeJwt(result.unwrap().token);
      expect(payload.scp).toEqual([EMBED_SCOPE]);
      expect(payload.email).toBe('embed-user@example.com');
      expect(payload.iss).toBe('test-issuer');
      expect(payload['https://tableau.com/tenantId']).toBe('test-tenant-id');
    });
  });
});
