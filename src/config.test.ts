import { exportedForTesting, ONE_HOUR_IN_MS, TEN_MINUTES_IN_MS } from './config.js';
import { stubDefaultEnvVars } from './testShared.js';

describe('Config', () => {
  const { Config, parseNumber } = exportedForTesting;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should throw error when SERVER is missing', () => {
    vi.stubEnv('SERVER', undefined);

    expect(() => new Config()).toThrow('The environment variable SERVER is not set');
  });

  it('should accept HTTP URLs for SERVER', () => {
    vi.stubEnv('SERVER', 'http://foo.com');

    const config = new Config();
    expect(config.server).toBe('http://foo.com');
  });

  it('should throw error when SERVER is not HTTP/HTTPS', () => {
    vi.stubEnv('SERVER', 'gopher://foo.com');

    expect(() => new Config()).toThrow(
      'The environment variable SERVER must start with "http://" or "https://": gopher://foo.com',
    );
  });

  it('should throw error when SERVER is not a valid URL', () => {
    vi.stubEnv('SERVER', 'https://');

    expect(() => new Config()).toThrow(
      'The environment variable SERVER is not a valid URL: https:// -- Invalid URL',
    );
  });

  it('should set siteName to empty string when SITE_NAME is "${user_config.site_name}"', () => {
    vi.stubEnv('SITE_NAME', '${user_config.site_name}');

    const config = new Config();
    expect(config.siteName).toBe('');
  });

  it('should throw error when PAT_NAME is missing', () => {
    vi.stubEnv('PAT_NAME', undefined);

    expect(() => new Config()).toThrow('The environment variable PAT_NAME is not set');
  });

  it('should throw error when PAT_VALUE is missing', () => {
    vi.stubEnv('PAT_VALUE', undefined);

    expect(() => new Config()).toThrow('The environment variable PAT_VALUE is not set');
  });

  it('should configure PAT authentication when PAT credentials are provided', () => {
    const config = new Config();
    expect(config.patName).toBe('sponge');
    expect(config.patValue).toBe('bob');
    expect(config.siteName).toBe('tc25');
  });

  it('should set default log level to debug when not specified', () => {
    const config = new Config();
    expect(config.defaultLogLevel).toBe('debug');
  });

  it('should set custom log level when specified', () => {
    vi.stubEnv('DEFAULT_LOG_LEVEL', 'info');

    const config = new Config();
    expect(config.defaultLogLevel).toBe('info');
  });

  it('should set disableLogMasking to false by default', () => {
    const config = new Config();
    expect(config.disableLogMasking).toBe(false);
  });

  it('should set disableLogMasking to true when specified', () => {
    vi.stubEnv('DISABLE_LOG_MASKING', 'true');

    const config = new Config();
    expect(config.disableLogMasking).toBe(true);
  });

  it('should set maxRequestTimeoutMs to the default value when not specified', () => {
    const config = new Config();
    expect(config.maxRequestTimeoutMs).toBe(10 * 60 * 1000);
  });

  it('should set maxRequestTimeoutMs to the specified value when specified', () => {
    vi.stubEnv('MAX_REQUEST_TIMEOUT_MS', '123456');

    const config = new Config();
    expect(config.maxRequestTimeoutMs).toBe(123456);
  });

  it('should set maxRequestTimeoutMs to the default value when specified as a non-number', () => {
    vi.stubEnv('MAX_REQUEST_TIMEOUT_MS', 'abc');

    const config = new Config();
    expect(config.maxRequestTimeoutMs).toBe(TEN_MINUTES_IN_MS);
  });

  it('should set maxRequestTimeoutMs to the default value when specified as a negative number', () => {
    vi.stubEnv('MAX_REQUEST_TIMEOUT_MS', '-100');

    const config = new Config();
    expect(config.maxRequestTimeoutMs).toBe(TEN_MINUTES_IN_MS);
  });

  it('should set maxRequestTimeoutMs to the default value when specified as a number greater than one hour', () => {
    vi.stubEnv('MAX_REQUEST_TIMEOUT_MS', `${ONE_HOUR_IN_MS + 1}`);

    const config = new Config();
    expect(config.maxRequestTimeoutMs).toBe(TEN_MINUTES_IN_MS);
  });

  it('should set disableSessionManagement to false by default', () => {
    const config = new Config();
    expect(config.disableSessionManagement).toBe(false);
  });

  it('should set disableMetadataApiRequests to true when specified', () => {
    vi.stubEnv('DISABLE_SESSION_MANAGEMENT', 'true');

    const config = new Config();
    expect(config.disableSessionManagement).toBe(true);
  });

  it('should default transport to stdio when not specified', () => {
    const config = new Config();
    expect(config.transport).toBe('stdio');
  });

  it('should set transport to http when specified', () => {
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');

    const config = new Config();
    expect(config.transport).toBe('http');
  });

  it('should set tableauServerVersionCheckIntervalInHours to default when not specified', () => {
    const config = new Config();
    expect(config.tableauServerVersionCheckIntervalInHours).toBe(1);
  });

  it('should set tableauServerVersionCheckIntervalInHours to the specified value when specified', () => {
    vi.stubEnv('TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS', '2');

    const config = new Config();
    expect(config.tableauServerVersionCheckIntervalInHours).toBe(2);
  });

  describe('HTTP server config parsing', () => {
    it('should set sslKey to default when SSL_KEY is not set', () => {
      const config = new Config();
      expect(config.sslKey).toBe('');
    });

    it('should set sslKey to the specified value when SSL_KEY is set', () => {
      vi.stubEnv('SSL_KEY', 'path/to/ssl-key.pem');

      const config = new Config();
      expect(config.sslKey).toBe('path/to/ssl-key.pem');
    });

    it('should set sslCert to default when SSL_CERT is not set', () => {
      const config = new Config();
      expect(config.sslCert).toBe('');
    });

    it('should set sslCert to the specified value when SSL_CERT is set', () => {
      vi.stubEnv('SSL_CERT', 'path/to/ssl-cert.pem');

      const config = new Config();
      expect(config.sslCert).toBe('path/to/ssl-cert.pem');
    });

    it('should set httpPort to default when HTTP_PORT_ENV_VAR_NAME and PORT are not set', () => {
      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });

    it('should set httpPort to the value of PORT when set', () => {
      vi.stubEnv('PORT', '8080');

      const config = new Config();
      expect(config.httpPort).toBe(8080);
    });

    it('should set httpPort to the value of the environment variable specified by HTTP_PORT_ENV_VAR_NAME when set', () => {
      vi.stubEnv('HTTP_PORT_ENV_VAR_NAME', 'CUSTOM_PORT');
      vi.stubEnv('CUSTOM_PORT', '41664');

      const config = new Config();
      expect(config.httpPort).toBe(41664);
    });

    it('should set httpPort to default when HTTP_PORT_ENV_VAR_NAME is set and custom port is not set', () => {
      vi.stubEnv('HTTP_PORT_ENV_VAR_NAME', 'CUSTOM_PORT');

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });

    it('should set httpPort to default when PORT is set to an invalid value', () => {
      vi.stubEnv('PORT', 'invalid');

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });

    it('should set httpPort to default when HTTP_PORT_ENV_VAR_NAME is set and custom port is invalid', () => {
      vi.stubEnv('HTTP_PORT_ENV_VAR_NAME', 'CUSTOM_PORT');
      vi.stubEnv('CUSTOM_PORT', 'invalid');

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });
  });

  describe('CORS origin config parsing', () => {
    it('should set corsOriginConfig to true when CORS_ORIGIN_CONFIG is not set', () => {
      const config = new Config();
      expect(config.corsOriginConfig).toBe(true);
    });

    it('should set corsOriginConfig to true when CORS_ORIGIN_CONFIG is "true"', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', 'true');

      const config = new Config();
      expect(config.corsOriginConfig).toBe(true);
    });

    it('should set corsOriginConfig to "*" when CORS_ORIGIN_CONFIG is "*"', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', '*');

      const config = new Config();
      expect(config.corsOriginConfig).toBe('*');
    });

    it('should set corsOriginConfig to false when CORS_ORIGIN_CONFIG is "false"', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', 'false');

      const config = new Config();
      expect(config.corsOriginConfig).toBe(false);
    });

    it('should set corsOriginConfig to the specified origin when CORS_ORIGIN_CONFIG is a valid URL', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', 'https://example.com:8080');

      const config = new Config();
      expect(config.corsOriginConfig).toBe('https://example.com:8080');
    });

    it('should set corsOriginConfig to the specified origins when CORS_ORIGIN_CONFIG is an array of URLs', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', '["https://example.com", "https://example.org"]');

      const config = new Config();
      expect(config.corsOriginConfig).toEqual(['https://example.com', 'https://example.org']);
    });

    it('should throw error when CORS_ORIGIN_CONFIG is not a valid URL', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', 'invalid');

      expect(() => new Config()).toThrow(
        'The environment variable CORS_ORIGIN_CONFIG is not a valid URL: invalid',
      );
    });

    it('should throw error when CORS_ORIGIN_CONFIG is not a valid array of URLs', () => {
      vi.stubEnv('CORS_ORIGIN_CONFIG', '["https://example.com", "invalid"]');

      expect(() => new Config()).toThrow(
        'The environment variable CORS_ORIGIN_CONFIG is not a valid array of URLs: ["https://example.com", "invalid"]',
      );
    });
  });

  describe('Trust proxy config parsing', () => {
    it('should set trustProxyConfig to null when TRUST_PROXY_CONFIG is not set', () => {
      const config = new Config();
      expect(config.trustProxyConfig).toBe(null);
    });

    it('should set trustProxyConfig to true when TRUST_PROXY_CONFIG is "true"', () => {
      vi.stubEnv('TRUST_PROXY_CONFIG', 'true');

      const config = new Config();
      expect(config.trustProxyConfig).toBe(true);
    });

    it('should set trustProxyConfig to false when TRUST_PROXY_CONFIG is "false"', () => {
      vi.stubEnv('TRUST_PROXY_CONFIG', 'false');

      const config = new Config();
      expect(config.trustProxyConfig).toBe(false);
    });

    it('should set trustProxyConfig to the specified number when TRUST_PROXY_CONFIG is a valid number', () => {
      vi.stubEnv('TRUST_PROXY_CONFIG', '1');

      const config = new Config();
      expect(config.trustProxyConfig).toBe(1);
    });

    it('should set trustProxyConfig to the specified string when TRUST_PROXY_CONFIG is a valid string', () => {
      vi.stubEnv('TRUST_PROXY_CONFIG', 'loopback, linklocal, uniquelocal');

      const config = new Config();
      expect(config.trustProxyConfig).toBe('loopback, linklocal, uniquelocal');
    });
  });

  describe('Connected App config parsing', () => {
    function stubDefaultDirectTrustEnvVars(): void {
      vi.stubEnv('AUTH', 'direct-trust');
      vi.stubEnv('JWT_SUB_CLAIM', 'test-jwt-sub-claim');
      vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'test-client-id');
      vi.stubEnv('CONNECTED_APP_SECRET_ID', 'test-secret-id');
      vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'test-secret-value');
    }

    beforeEach(() => {
      stubDefaultDirectTrustEnvVars();
    });

    it('should configure direct-trust authentication when all required variables are provided', () => {
      const config = new Config();
      expect(config.auth).toBe('direct-trust');
      expect(config.jwtUsername).toBe('test-jwt-sub-claim');
      expect(config.connectedAppClientId).toBe('test-client-id');
      expect(config.connectedAppSecretId).toBe('test-secret-id');
      expect(config.connectedAppSecretValue).toBe('test-secret-value');
      expect(config.jwtAdditionalPayload).toBe('{}');
    });

    it('should set jwtAdditionalPayload to the specified value when JWT_ADDITIONAL_PAYLOAD is set', () => {
      vi.stubEnv('JWT_ADDITIONAL_PAYLOAD', '{"custom":"payload"}');

      const config = new Config();
      expect(JSON.parse(config.jwtAdditionalPayload)).toEqual({ custom: 'payload' });
    });

    it('should throw error when JWT_SUB_CLAIM is missing for direct-trust auth', () => {
      vi.stubEnv('JWT_SUB_CLAIM', undefined);

      expect(() => new Config()).toThrow('The environment variable JWT_SUB_CLAIM is not set');
    });

    it('should throw error when CONNECTED_APP_CLIENT_ID is missing for direct-trust auth', () => {
      vi.stubEnv('CONNECTED_APP_CLIENT_ID', undefined);

      expect(() => new Config()).toThrow(
        'The environment variable CONNECTED_APP_CLIENT_ID is not set',
      );
    });

    it('should throw error when CONNECTED_APP_SECRET_ID is missing for direct-trust auth', () => {
      vi.stubEnv('CONNECTED_APP_SECRET_ID', undefined);

      expect(() => new Config()).toThrow(
        'The environment variable CONNECTED_APP_SECRET_ID is not set',
      );
    });

    it('should throw error when CONNECTED_APP_SECRET_VALUE is missing for direct-trust auth', () => {
      vi.stubEnv('CONNECTED_APP_SECRET_VALUE', undefined);

      expect(() => new Config()).toThrow(
        'The environment variable CONNECTED_APP_SECRET_VALUE is not set',
      );
    });

    it('should allow PAT_NAME and PAT_VALUE to be empty when AUTH is "direct-trust"', () => {
      vi.stubEnv('PAT_NAME', undefined);
      vi.stubEnv('PAT_VALUE', undefined);

      const config = new Config();
      expect(config.patName).toBe('');
      expect(config.patValue).toBe('');
    });

    it('should allow all direct-trust fields to be empty when AUTH is not "direct-trust"', () => {
      vi.stubEnv('AUTH', 'pat');
      vi.stubEnv('JWT_SUB_CLAIM', undefined);
      vi.stubEnv('CONNECTED_APP_CLIENT_ID', undefined);
      vi.stubEnv('CONNECTED_APP_SECRET_ID', undefined);
      vi.stubEnv('CONNECTED_APP_SECRET_VALUE', undefined);
      vi.stubEnv('JWT_ADDITIONAL_PAYLOAD', undefined);

      const config = new Config();
      expect(config.auth).toBe('pat');
      expect(config.jwtUsername).toBe('');
      expect(config.connectedAppClientId).toBe('');
      expect(config.connectedAppSecretId).toBe('');
      expect(config.connectedAppSecretValue).toBe('');
      expect(config.jwtAdditionalPayload).toBe('{}');
    });
  });

  describe('UAT configuration config parsing', () => {
    function stubDefaultUatEnvVars(): void {
      vi.stubEnv('AUTH', 'uat');
      vi.stubEnv('UAT_TENANT_ID', 'test-tenant-id');
      vi.stubEnv('UAT_ISSUER', 'test-issuer');
      vi.stubEnv('UAT_USERNAME_CLAIM', 'test-username');
      vi.stubEnv('UAT_PRIVATE_KEY', 'test-private-key');
      vi.stubEnv('UAT_KEY_ID', 'test-key-id');
    }

    beforeEach(() => {
      stubDefaultUatEnvVars();
    });

    it('should configure uat authentication when all required variables are provided', () => {
      const config = new Config();
      expect(config.auth).toBe('uat');
      expect(config.uatTenantId).toBe('test-tenant-id');
      expect(config.uatIssuer).toBe('test-issuer');
      expect(config.uatUsernameClaimName).toBe('email');
      expect(config.jwtUsername).toBe('test-username');
      expect(config.uatPrivateKey).toBe('test-private-key');
      expect(config.uatKeyId).toBe('test-key-id');
    });

    it('should fall back to JWT_SUB_CLAIM when UAT_USERNAME_CLAIM is not set', () => {
      vi.stubEnv('UAT_USERNAME_CLAIM', undefined);
      vi.stubEnv('JWT_SUB_CLAIM', 'test-jwt-sub-claim');

      const config = new Config();
      expect(config.jwtUsername).toBe('test-jwt-sub-claim');
    });

    it('should set uatUsernameClaimName to the specified value when UAT_USERNAME_CLAIM_NAME is set', () => {
      vi.stubEnv('UAT_USERNAME_CLAIM_NAME', 'test-username-claim-name');

      const config = new Config();
      expect(config.uatUsernameClaimName).toBe('test-username-claim-name');
    });

    it('should throw error when UAT_TENANT_ID is missing', () => {
      vi.stubEnv('UAT_TENANT_ID', undefined);

      expect(() => new Config()).toThrow('The environment variable UAT_TENANT_ID is not set');
    });

    it('should throw error when UAT_ISSUER is missing', () => {
      vi.stubEnv('UAT_ISSUER', undefined);

      expect(() => new Config()).toThrow('The environment variable UAT_ISSUER is not set');
    });

    it('should throw error when UAT_USERNAME_CLAIM is missing and JWT_SUB_CLAIM is not set', () => {
      vi.stubEnv('UAT_USERNAME_CLAIM', undefined);
      vi.stubEnv('JWT_SUB_CLAIM', undefined);

      expect(() => new Config()).toThrow(
        'One of the environment variables: UAT_USERNAME_CLAIM or JWT_SUB_CLAIM must be set',
      );
    });

    it('should throw error when UAT_PRIVATE_KEY and UAT_PRIVATE_KEY_PATH is not set', () => {
      vi.stubEnv('UAT_PRIVATE_KEY', undefined);
      vi.stubEnv('UAT_PRIVATE_KEY_PATH', undefined);

      expect(() => new Config()).toThrow(
        'One of the environment variables: UAT_PRIVATE_KEY_PATH or UAT_PRIVATE_KEY must be set',
      );
    });

    it('should throw error when UAT_PRIVATE_KEY and UAT_PRIVATE_KEY_PATH are both set', () => {
      vi.stubEnv('UAT_PRIVATE_KEY', 'hamburgers');
      vi.stubEnv('UAT_PRIVATE_KEY_PATH', 'hotdogs');

      expect(() => new Config()).toThrow(
        'Only one of the environment variables: UAT_PRIVATE_KEY or UAT_PRIVATE_KEY_PATH must be set',
      );
    });
  });

  describe('OAuth configuration', () => {
    function stubDefaultOAuthEnvVars(): void {
      vi.stubEnv('OAUTH_ISSUER', 'https://example.com');
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY_PATH', 'path/to/private.pem');
      vi.stubEnv('TABLEAU_MCP_TEST', 'true');
    }

    const defaultOAuthTimeoutMs = {
      authzCodeTimeoutMs: 10 * 60 * 1000,
      accessTokenTimeoutMs: 1 * 60 * 60 * 1000,
      refreshTokenTimeoutMs: 30 * 24 * 60 * 60 * 1000,
    };

    const defaultOAuthConfig = {
      enabled: true,
      clientIdSecretPairs: null,
      issuer: 'https://example.com',
      redirectUri: 'https://example.com/Callback',
      lockSite: true,
      jwePrivateKey: '',
      jwePrivateKeyPath: 'path/to/private.pem',
      jwePrivateKeyPassphrase: undefined,
      dnsServers: ['1.1.1.1', '1.0.0.1'],
      ...defaultOAuthTimeoutMs,
    } as const;

    it('should default to disabled', () => {
      const config = new Config();
      expect(config.oauth).toEqual({
        enabled: false,
        issuer: '',
        clientIdSecretPairs: null,
        redirectUri: '',
        lockSite: true,
        jwePrivateKey: '',
        jwePrivateKeyPath: '',
        jwePrivateKeyPassphrase: undefined,
        dnsServers: ['1.1.1.1', '1.0.0.1'],
        ...defaultOAuthTimeoutMs,
      });
    });

    it('should enable OAuth when OAUTH_ISSUER is set', () => {
      stubDefaultOAuthEnvVars();

      const config = new Config();
      expect(config.oauth).toEqual(defaultOAuthConfig);
    });

    it('should disable OAuth when DANGEROUSLY_DISABLE_OAUTH is "true"', () => {
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');

      const config = new Config();
      expect(config.oauth.enabled).toEqual(false);
    });

    it('should set redirectUri to the specified value when OAUTH_REDIRECT_URI is set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_REDIRECT_URI', 'https://example.com/CustomCallback');

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        redirectUri: 'https://example.com/CustomCallback',
      });
    });

    it('should set redirectUri to the default value when OAUTH_REDIRECT_URI is not set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_REDIRECT_URI', '');

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        redirectUri: 'https://example.com/Callback',
      });
    });

    it('should set lockSite to the specified value when OAUTH_LOCK_SITE is set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_LOCK_SITE', 'false');

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        lockSite: false,
      });
    });

    it('should set jwePrivateKey to the specified value when OAUTH_JWE_PRIVATE_KEY is set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY', 'hamburgers');
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY_PATH', '');

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        jwePrivateKey: 'hamburgers',
        jwePrivateKeyPath: '',
        jwePrivateKeyPassphrase: undefined,
      });
    });

    it('should set authzCodeTimeoutMs to the specified value when OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS is set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS', '5678');

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        authzCodeTimeoutMs: 5678,
      });
    });

    it('should set accessTokenTimeoutMs to the specified value when OAUTH_ACCESS_TOKEN_TIMEOUT_MS is set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_ACCESS_TOKEN_TIMEOUT_MS', '1234');

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        accessTokenTimeoutMs: 1234,
      });
    });

    it('should set refreshTokenTimeoutMs to the specified value when OAUTH_REFRESH_TOKEN_TIMEOUT_MS is set', () => {
      vi.stubEnv('OAUTH_REFRESH_TOKEN_TIMEOUT_MS', '1234');

      const config = new Config();
      expect(config.oauth.refreshTokenTimeoutMs).toBe(1234);
    });

    it('should throw error when TRANSPORT is "http" and OAUTH_ISSUER is not set', () => {
      vi.stubEnv('TRANSPORT', 'http');
      vi.stubEnv('OAUTH_ISSUER', undefined);

      expect(() => new Config()).toThrow(
        'OAUTH_ISSUER must be set when TRANSPORT is "http" unless DANGEROUSLY_DISABLE_OAUTH is "true"',
      );
    });

    it('should throw error when OAUTH_JWE_PRIVATE_KEY and OAUTH_JWE_PRIVATE_KEY_PATH is not set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY_PATH', '');

      expect(() => new Config()).toThrow(
        'One of the environment variables: OAUTH_JWE_PRIVATE_KEY_PATH or OAUTH_JWE_PRIVATE_KEY must be set',
      );
    });

    it('should throw error when OAUTH_JWE_PRIVATE_KEY and OAUTH_JWE_PRIVATE_KEY_PATH are both set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY', 'hamburgers');
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY_PATH', 'hotdogs');

      expect(() => new Config()).toThrow(
        'Only one of the environment variables: OAUTH_JWE_PRIVATE_KEY or OAUTH_JWE_PRIVATE_KEY_PATH must be set',
      );
    });

    it('should throw error when AUTH is "oauth" and OAUTH_ISSUER is not set', () => {
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('OAUTH_ISSUER', '');

      expect(() => new Config()).toThrow('When AUTH is "oauth", OAUTH_ISSUER must be set');
    });

    it('should throw error when AUTH is "oauth" and DANGEROUSLY_DISABLE_OAUTH is set', () => {
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');

      expect(() => new Config()).toThrow(
        'When AUTH is "oauth", DANGEROUSLY_DISABLE_OAUTH cannot be "true"',
      );
    });

    it('should default transport to "http" when OAUTH_ISSUER is set', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('TRANSPORT', undefined);

      const config = new Config();
      expect(config.transport).toBe('http');
    });

    it('should default auth to "oauth" when OAUTH_ISSUER is set', () => {
      stubDefaultOAuthEnvVars();
      const config = new Config();
      expect(config.auth).toBe('oauth');
    });

    it('should throw error when transport is stdio and auth is "oauth"', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('TRANSPORT', 'stdio');

      expect(() => new Config()).toThrow('TRANSPORT must be "http" when OAUTH_ISSUER is set');
    });

    it('should allow PAT_NAME and PAT_VALUE to be empty when AUTH is "oauth"', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('PAT_NAME', undefined);
      vi.stubEnv('PAT_VALUE', undefined);
      vi.stubEnv('AUTH', 'oauth');

      const config = new Config();
      expect(config.patName).toBe('');
      expect(config.patValue).toBe('');
    });

    it('should allow SITE_NAME to be empty when AUTH is "oauth"', () => {
      stubDefaultOAuthEnvVars();
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('SITE_NAME', '');

      const config = new Config();
      expect(config.siteName).toBe('');
    });

    it('should set clientIdSecretPairs to the specified value when OAUTH_CLIENT_ID_SECRET_PAIRS is set', () => {
      vi.stubEnv('OAUTH_CLIENT_ID_SECRET_PAIRS', 'client1:secret1,client2:secret2');

      const config = new Config();
      expect(config.oauth.clientIdSecretPairs).toEqual({
        client1: 'secret1',
        client2: 'secret2',
      });
    });

    it('should set dnsServers to the specified value when OAUTH_CIMD_DNS_SERVERS is set', () => {
      vi.stubEnv('OAUTH_CIMD_DNS_SERVERS', '8.8.8.8,8.8.4.4');

      const config = new Config();
      expect(config.oauth.dnsServers).toEqual(['8.8.8.8', '8.8.4.4']);
    });
  });

  describe('parseNumber', () => {
    it('should return defaultValue when value is undefined', () => {
      const result = parseNumber(undefined, { defaultValue: 42 });
      expect(result).toBe(42);
    });

    it('should return defaultValue when value is empty string', () => {
      const result = parseNumber('', { defaultValue: 42 });
      expect(result).toBe(42);
    });

    it('should return defaultValue when value is whitespace', () => {
      const result = parseNumber('   ', { defaultValue: 42 });
      expect(result).toBe(42);
    });

    it('should return defaultValue when value is not a number', () => {
      const result = parseNumber('abc', { defaultValue: 42 });
      expect(result).toBe(42);
    });

    it('should return defaultValue when value is NaN', () => {
      const result = parseNumber('NaN', { defaultValue: 42 });
      expect(result).toBe(42);
    });

    it('should parse valid integer string', () => {
      const result = parseNumber('123', { defaultValue: 42 });
      expect(result).toBe(123);
    });

    it('should parse valid integer string with leading zeros', () => {
      const result = parseNumber('007', { defaultValue: 42 });
      expect(result).toBe(7);
    });

    it('should parse valid integer string with whitespace', () => {
      const result = parseNumber('  456  ', { defaultValue: 42 });
      expect(result).toBe(456);
    });

    it('should parse valid decimal string', () => {
      const result = parseNumber('123.45', { defaultValue: 42 });
      expect(result).toBe(123.45);
    });

    it('should parse valid decimal string with whitespace', () => {
      const result = parseNumber('  123.45  ', { defaultValue: 42 });
      expect(result).toBe(123.45);
    });

    it('should return defaultValue when value is below minValue', () => {
      const result = parseNumber('5', { defaultValue: 42, minValue: 10 });
      expect(result).toBe(42);
    });

    it('should return defaultValue when value is above maxValue', () => {
      const result = parseNumber('100', { defaultValue: 42, maxValue: 50 });
      expect(result).toBe(42);
    });

    it('should parse valid number when within minValue and maxValue range', () => {
      const result = parseNumber('25', { defaultValue: 42, minValue: 10, maxValue: 50 });
      expect(result).toBe(25);
    });

    it('should parse valid number when value equals minValue', () => {
      const result = parseNumber('10', { defaultValue: 42, minValue: 10, maxValue: 50 });
      expect(result).toBe(10);
    });

    it('should parse valid number when value equals maxValue', () => {
      const result = parseNumber('50', { defaultValue: 42, minValue: 10, maxValue: 50 });
      expect(result).toBe(50);
    });

    it('should use default options when no options provided', () => {
      const result = parseNumber('123');
      expect(result).toBe(123);
    });

    it('should use default defaultValue of 0 when no options provided', () => {
      const result = parseNumber('abc');
      expect(result).toBe(0);
    });

    it('should handle negative numbers with appropriate minValue', () => {
      const result = parseNumber('-5', { defaultValue: 42, minValue: -10 });
      expect(result).toBe(-5);
    });

    it('should return defaultValue for negative numbers when minValue is 0', () => {
      const result = parseNumber('-5', { defaultValue: 42, minValue: 0 });
      expect(result).toBe(42);
    });
  });
});
