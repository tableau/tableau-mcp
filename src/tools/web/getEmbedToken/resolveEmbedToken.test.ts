import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';

import { AuthConfig } from '../../../sdks/tableau/authConfig.js';
import { EMBED_SCOPE, resolveEmbedToken } from './resolveEmbedToken.js';

const directTrustAuthConfig: AuthConfig = {
  type: 'direct-trust',
  siteName: 'site',
  username: 'embed-user@example.com',
  clientId: 'client-id-123',
  secretId: 'secret-id-456',
  secretValue: 'super-secret-value',
  scopes: new Set(),
};

const patAuthConfig: AuthConfig = {
  type: 'pat',
  siteName: 'site',
  patName: 'test-pat-name',
  patValue: 'test-pat-value',
};

describe('resolveEmbedToken', () => {
  it('signs a direct-trust embed JWT with the embed scope and configured username', async () => {
    const result = await resolveEmbedToken({
      authConfig: directTrustAuthConfig,
    });

    expect(result.isOk()).toBe(true);
    const payload = decodeJwt(result.unwrap().token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
    expect(payload.iss).toBe('client-id-123');
    expect(payload.aud).toBe('tableau');
  });

  it('includes additionalPayload in the signed JWT', async () => {
    const authConfigWithPayload: AuthConfig = {
      ...directTrustAuthConfig,
      additionalPayload: { custom: 'value', other: 123 },
    };

    const result = await resolveEmbedToken({
      authConfig: authConfigWithPayload,
    });

    expect(result.isOk()).toBe(true);
    const payload = decodeJwt(result.unwrap().token);
    expect(payload.custom).toBe('value');
    expect(payload.other).toBe(123);
  });

  it('returns not-available for pat AuthConfig', async () => {
    const result = await resolveEmbedToken({
      authConfig: patAuthConfig,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe('embed-token-not-available');
  });

  describe('uat embed token', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);

    const uatAuthConfig: AuthConfig = {
      type: 'uat',
      siteName: 'site',
      username: 'embed-user@example.com',
      tenantId: 'test-tenant-id',
      issuer: 'test-issuer',
      usernameClaimName: 'email',
      privateKey: privateKeyPem,
      keyId: 'test-key-id',
      scopes: new Set(),
    };

    it('signs a uat embed JWT from the UAT key with the embed scope', async () => {
      const result = await resolveEmbedToken({
        authConfig: uatAuthConfig,
      });

      expect(result.isOk()).toBe(true);
      const payload = decodeJwt(result.unwrap().token);
      expect(payload.scp).toEqual([EMBED_SCOPE]);
      expect(payload.email).toBe('embed-user@example.com');
      expect(payload.iss).toBe('test-issuer');
      expect(payload['https://tableau.com/tenantId']).toBe('test-tenant-id');
    });

    it('includes additionalPayload in the uat JWT', async () => {
      const uatConfigWithPayload: AuthConfig = {
        ...uatAuthConfig,
        additionalPayload: { team: 'engineering' },
      };

      const result = await resolveEmbedToken({
        authConfig: uatConfigWithPayload,
      });

      expect(result.isOk()).toBe(true);
      const payload = decodeJwt(result.unwrap().token);
      expect(payload.team).toBe('engineering');
    });
  });
});
