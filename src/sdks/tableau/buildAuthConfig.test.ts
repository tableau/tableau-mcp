import { describe, expect, it } from 'vitest';

import { getMockRequestHandlerExtra } from '../../tools/web/toolContext.mock.js';
import { buildAuthConfig } from './buildAuthConfig.js';

describe('buildAuthConfig', () => {
  it('builds AuthConfig for pat mode', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'pat';
    extra.config.patName = 'test-pat-name';
    extra.config.patValue = 'test-pat-value';
    extra.config.siteName = 'test-site';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: undefined,
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toEqual({
      type: 'pat',
      siteName: 'test-site',
      patName: 'test-pat-name',
      patValue: 'test-pat-value',
    });
  });

  it('builds AuthConfig for direct-trust mode with scopes', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = 'test-user@example.com';
    extra.config.connectedAppClientId = 'client-id-123';
    extra.config.connectedAppSecretId = 'secret-id-456';
    extra.config.connectedAppSecretValue = 'super-secret';
    extra.config.jwtAdditionalPayload = '{"custom":"claim"}';

    const scopes = new Set(['tableau:content:read', 'tableau:views:embed']);
    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: undefined,
      scopes,
    });

    expect(result).toEqual({
      type: 'direct-trust',
      siteName: 'test-site',
      username: 'test-user@example.com',
      clientId: 'client-id-123',
      secretId: 'secret-id-456',
      secretValue: 'super-secret',
      scopes,
      additionalPayload: { custom: 'claim' },
    });
  });

  it('builds AuthConfig for uat mode with scopes', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'uat';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = 'uat-user@example.com';
    extra.config.uatTenantId = 'tenant-123';
    extra.config.uatIssuer = 'https://issuer.example.com';
    extra.config.uatUsernameClaimName = 'email';
    extra.config.uatPrivateKey = 'mock-private-key';
    extra.config.uatKeyId = 'key-id-789';
    extra.config.jwtAdditionalPayload = '{"role":"admin"}';

    const scopes = new Set(['tableau:content:read']);
    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: undefined,
      scopes,
    });

    expect(result).toEqual({
      type: 'uat',
      siteName: 'test-site',
      username: 'uat-user@example.com',
      tenantId: 'tenant-123',
      issuer: 'https://issuer.example.com',
      usernameClaimName: 'email',
      privateKey: 'mock-private-key',
      keyId: 'key-id-789',
      scopes,
      additionalPayload: { role: 'admin' },
    });
  });

  it('returns null for oauth mode', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'oauth';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: undefined,
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toBeNull();
  });

  it('applies {OAUTH_USERNAME} substitution in jwtUsername', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = '{OAUTH_USERNAME}';
    extra.config.connectedAppClientId = 'client-id';
    extra.config.connectedAppSecretId = 'secret-id';
    extra.config.connectedAppSecretValue = 'secret';
    extra.config.jwtAdditionalPayload = '{}';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username: 'real-user@example.com',
        server: 'https://example.com',
        siteName: 'test-site',
      },
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.username).toBe('real-user@example.com');
    }
  });

  it('applies {OAUTH_USERNAME} substitution in jwtAdditionalPayload', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = 'static-user@example.com';
    extra.config.connectedAppClientId = 'client-id';
    extra.config.connectedAppSecretId = 'secret-id';
    extra.config.connectedAppSecretValue = 'secret';
    extra.config.jwtAdditionalPayload = '{"email":"{OAUTH_USERNAME}","role":"editor"}';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username: 'oauth-user@example.com',
        server: 'https://example.com',
        siteName: 'test-site',
      },
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.additionalPayload).toEqual({
        email: 'oauth-user@example.com',
        role: 'editor',
      });
    }
  });

  it('handles empty jwtAdditionalPayload by parsing as empty object', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = 'user@example.com';
    extra.config.connectedAppClientId = 'client-id';
    extra.config.connectedAppSecretId = 'secret-id';
    extra.config.connectedAppSecretValue = 'secret';
    extra.config.jwtAdditionalPayload = '';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: undefined,
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.additionalPayload).toEqual({});
    }
  });

  it('applies {OAUTH_USERNAME} substitution in jwtUsername with multiple occurrences', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = 'prefix-{OAUTH_USERNAME}-suffix-{OAUTH_USERNAME}';
    extra.config.connectedAppClientId = 'client-id';
    extra.config.connectedAppSecretId = 'secret-id';
    extra.config.connectedAppSecretValue = 'secret';
    extra.config.jwtAdditionalPayload = '{}';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: {
        type: 'Bearer',
        raw: 'token',
        username: 'user@example.com',
        server: 'https://example.com',
        siteId: 'site-id',
        siteName: 'test-site',
        clientId: 'client-id',
      },
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.username).toBe('prefix-user@example.com-suffix-user@example.com');
    }
  });

  it('replaces {OAUTH_USERNAME} with empty string when tableauAuthInfo is undefined', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = 'prefix-{OAUTH_USERNAME}';
    extra.config.connectedAppClientId = 'client-id';
    extra.config.connectedAppSecretId = 'secret-id';
    extra.config.connectedAppSecretValue = 'secret';
    extra.config.jwtAdditionalPayload = '{}';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: undefined,
      scopes: new Set(['tableau:content:read']),
    });

    expect(result).toBeDefined();
    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.username).toBe('prefix-');
    }
  });
});

describe('buildAuthConfig uat outer-token username', () => {
  it('derives the UAT subject only from the authenticated principal and never crosses to config.siteName implicitly', () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'uat';
    extra.config.siteName = 'site-b';
    extra.config.jwtUsername = '{OAUTH_USERNAME}';

    const result = buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username: 'viewer-a@example.com',
        server: 'https://10ay.online.tableau.com',
        siteName: 'site-b',
        siteId: 'luid-site-a',
      },
      scopes: new Set(),
    });

    expect(result).toMatchObject({
      type: 'uat',
      siteName: 'site-b',
      username: 'viewer-a@example.com',
    });
  });
});

describe('buildAuthConfig external authorization server identity', () => {
  it.each(['direct-trust', 'uat'] as const)(
    'uses the external username as the %s username (the JWT sub)',
    (auth) => {
      const extra = getMockRequestHandlerExtra();
      extra.config.auth = auth;
      extra.config.siteName = 'test-site';
      extra.config.jwtUsername = '{OAUTH_USERNAME}';
      extra.config.connectedAppClientId = 'client-id';
      extra.config.connectedAppSecretId = 'secret-id';
      extra.config.connectedAppSecretValue = 'secret';

      // The shape ExternalAccessTokenValidator produces: no user, site, or Tableau token.
      const result = buildAuthConfig({
        config: extra.config,
        tableauAuthInfo: {
          type: 'X-Tableau-Auth',
          username: 'jdoe@example.com',
          server: extra.config.server,
          siteName: extra.config.siteName,
        },
        scopes: new Set(['tableau:content:read']),
      });

      expect(result).toMatchObject({
        type: auth,
        siteName: 'test-site',
        username: 'jdoe@example.com',
      });
    },
  );
});

describe('buildAuthConfig {OAUTH_USERNAME} substitution is literal', () => {
  function buildDirectTrust({
    username,
    jwtUsername = '{OAUTH_USERNAME}',
    jwtAdditionalPayload = '{}',
  }: {
    username: string;
    jwtUsername?: string;
    jwtAdditionalPayload?: string;
  }): ReturnType<typeof buildAuthConfig> {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = jwtUsername;
    extra.config.connectedAppClientId = 'client-id';
    extra.config.connectedAppSecretId = 'secret-id';
    extra.config.connectedAppSecretValue = 'secret';
    extra.config.jwtAdditionalPayload = jwtAdditionalPayload;

    return buildAuthConfig({
      config: extra.config,
      tableauAuthInfo: {
        type: 'X-Tableau-Auth',
        username,
        server: 'https://example.com',
        siteName: 'test-site',
      },
      scopes: new Set(['tableau:content:read']),
    });
  }

  it.each([
    ['bob$$', '{OAUTH_USERNAME}', 'bob$$'],
    ['$&', '{OAUTH_USERNAME}', '$&'],
    ['$`', '{OAUTH_USERNAME}', '$`'],
    ["$'", '{OAUTH_USERNAME}', "$'"],
    ['bob$$', '{OAUTH_USERNAME}@corp.com', 'bob$$@corp.com'],
    ['$&', '{OAUTH_USERNAME}@corp.com', '$&@corp.com'],
    ['$`', '{OAUTH_USERNAME}@corp.com', '$`@corp.com'],
    ["$'", '{OAUTH_USERNAME}@corp.com', "$'@corp.com"],
  ])('substitutes username %j into jwtUsername %j as %j', (username, jwtUsername, expected) => {
    const result = buildDirectTrust({ username, jwtUsername });

    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.username).toBe(expected);
    }
  });

  it.each([
    ['a double quote', 'o"brien@example.com'],
    ['a backslash', 'DOMAIN\\user'],
    ['a control character', 'line1\nline2'],
    ['a payload-injection attempt', 'x","scp":["tableau:content:*"],"a":"'],
    ['String.replace patterns', "x$'$&$`$$"],
  ])('keeps the operator payload keys for a username with %s', (_, username) => {
    const result = buildDirectTrust({
      username,
      jwtAdditionalPayload: '{"email":"{OAUTH_USERNAME}","role":"editor"}',
    });

    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.additionalPayload).toEqual({ email: username, role: 'editor' });
    }
  });

  it('throws instead of adding payload keys for a bare placeholder with an injection attempt', () => {
    expect(() =>
      buildDirectTrust({
        username: '1,"scp":["tableau:content:*"]',
        jwtAdditionalPayload: '{"n":{OAUTH_USERNAME}}',
      }),
    ).toThrow(SyntaxError);
  });

  it('substitutes a numeric username into a bare placeholder as a number', () => {
    const result = buildDirectTrust({
      username: '123',
      jwtAdditionalPayload: '{"n":{OAUTH_USERNAME}}',
    });

    expect(result?.type).toBe('direct-trust');
    if (result?.type === 'direct-trust') {
      expect(result.additionalPayload).toEqual({ n: 123 });
    }
  });
});
