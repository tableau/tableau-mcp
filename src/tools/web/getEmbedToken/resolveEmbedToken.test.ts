import { decodeJwt } from 'jose';

import { EMBED_SCOPE, resolveEmbedToken } from './resolveEmbedToken.js';

const BEARER_JWT = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';

const directTrustConfig = {
  auth: 'direct-trust' as const,
  connectedAppClientId: 'client-id-123',
  connectedAppSecretId: 'secret-id-456',
  connectedAppSecretValue: 'super-secret-value',
  jwtUsername: 'embed-user@example.com',
  embeddingConnectedAppClientId: '',
  embeddingConnectedAppSecretId: '',
  embeddingConnectedAppSecretValue: '',
  embeddingUsername: '',
};

const bearerAuthInfo = {
  type: 'Bearer' as const,
  raw: BEARER_JWT,
  username: 'bearer-user@example.com',
  server: 'https://example.com',
  siteId: 'site-id',
  siteName: 'site',
};

const embeddingConfig = {
  auth: 'pat' as const,
  connectedAppClientId: '',
  connectedAppSecretId: '',
  connectedAppSecretValue: '',
  jwtUsername: '',
  embeddingConnectedAppClientId: 'embed-client-id',
  embeddingConnectedAppSecretId: 'embed-secret-id',
  embeddingConnectedAppSecretValue: 'embed-secret-value',
  embeddingUsername: 'embed-user@example.com',
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
        embeddingConnectedAppClientId: '',
        embeddingConnectedAppSecretId: '',
        embeddingConnectedAppSecretValue: '',
        embeddingUsername: '',
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
        embeddingConnectedAppClientId: '',
        embeddingConnectedAppSecretId: '',
        embeddingConnectedAppSecretValue: '',
        embeddingUsername: '',
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

  it('signs a pat embed JWT from the embedding credential with the embed scope and EMBEDDING_USERNAME', async () => {
    const result = await resolveEmbedToken({
      config: embeddingConfig,
      tableauAuthInfo: undefined,
    });

    expect(result.isOk()).toBe(true);
    const payload = decodeJwt(result.unwrap().token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
    expect(payload.iss).toBe('embed-client-id');
    expect(payload.aud).toBe('tableau');
  });

  it('signs a uat embed JWT from the embedding credential', async () => {
    const result = await resolveEmbedToken({
      config: { ...embeddingConfig, auth: 'uat' },
      tableauAuthInfo: undefined,
    });

    expect(result.isOk()).toBe(true);
    const payload = decodeJwt(result.unwrap().token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
  });

  it('signs from the embedding credential even when an X-Tableau-Auth authInfo is present (pat embedded-authz)', async () => {
    const result = await resolveEmbedToken({
      config: embeddingConfig,
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username: 'pat-user@example.com',
        server: 'https://example.com',
        siteName: 'site',
      },
    });

    expect(result.isOk()).toBe(true);
    expect(decodeJwt(result.unwrap().token).scp).toEqual([EMBED_SCOPE]);
  });

  it('prefers a present Bearer JWT over the embedding credential', async () => {
    const result = await resolveEmbedToken({
      config: embeddingConfig,
      tableauAuthInfo: bearerAuthInfo,
    });

    expect(result.unwrap().token).toBe(BEARER_JWT);
  });

  it('uses the direct-trust credential, not the embedding credential, when AUTH is direct-trust and both are set', async () => {
    const result = await resolveEmbedToken({
      config: {
        ...directTrustConfig,
        embeddingConnectedAppClientId: 'embed-client-id',
        embeddingConnectedAppSecretId: 'embed-secret-id',
        embeddingConnectedAppSecretValue: 'embed-secret-value',
        embeddingUsername: 'embed-user@example.com',
      },
      tableauAuthInfo: undefined,
    });

    expect(result.isOk()).toBe(true);
    const payload = decodeJwt(result.unwrap().token);
    expect(payload.iss).toBe('client-id-123');
  });

  it('returns not-available when the embedding credential is only partially present', async () => {
    const result = await resolveEmbedToken({
      config: {
        ...embeddingConfig,
        embeddingConnectedAppSecretValue: '',
        embeddingUsername: '',
      },
      tableauAuthInfo: undefined,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toBe('embed-token-not-available');
  });
});
