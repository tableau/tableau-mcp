import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportedForTesting } from './config.js';

describe('Config', () => {
  const { Config, parseNumber } = exportedForTesting;

  const originalEnv = process.env;

  const defaultEnvVars = {
    SERVER: 'https://test-server.com',
    SITE_NAME: 'test-site',
    PAT_NAME: 'test-pat-name',
    PAT_VALUE: 'test-pat-value',
  } as const;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AUTH: undefined,
      TRANSPORT: undefined,
      HTTP_PORT_ENV_VAR_NAME: undefined,
      PORT: undefined,
      CUSTOM_PORT: undefined,
      CORS_ORIGIN_CONFIG: undefined,
      TRUST_PROXY_CONFIG: undefined,
      SERVER: undefined,
      SITE_NAME: undefined,
      PAT_NAME: undefined,
      PAT_VALUE: undefined,
      JWT_SUB_CLAIM: undefined,
      CONNECTED_APP_CLIENT_ID: undefined,
      CONNECTED_APP_SECRET_ID: undefined,
      CONNECTED_APP_SECRET_VALUE: undefined,
      JWT_ADDITIONAL_PAYLOAD: undefined,
      DATASOURCE_CREDENTIALS: undefined,
      DEFAULT_LOG_LEVEL: undefined,
      DISABLE_LOG_MASKING: undefined,
      INCLUDE_TOOLS: undefined,
      EXCLUDE_TOOLS: undefined,
      MAX_RESULT_LIMIT: undefined,
      DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: undefined,
      DISABLE_METADATA_API_REQUESTS: undefined,
      DISABLE_SESSION_MANAGEMENT: undefined,
      ENABLE_SERVER_LOGGING: undefined,
      SERVER_LOG_DIRECTORY: undefined,
      INCLUDE_PROJECT_IDS: undefined,
      INCLUDE_DATASOURCE_IDS: undefined,
      INCLUDE_WORKBOOK_IDS: undefined,
      TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: undefined,
      DANGEROUSLY_DISABLE_OAUTH: undefined,
      OAUTH_ISSUER: undefined,
      OAUTH_REDIRECT_URI: undefined,
      OAUTH_JWE_PRIVATE_KEY: undefined,
      OAUTH_JWE_PRIVATE_KEY_PATH: undefined,
      OAUTH_JWE_PRIVATE_KEY_PASSPHRASE: undefined,
      OAUTH_CIMD_DNS_SERVERS: undefined,
      OAUTH_ACCESS_TOKEN_TIMEOUT_MS: undefined,
      OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: undefined,
      OAUTH_REFRESH_TOKEN_TIMEOUT_MS: undefined,
      OAUTH_CLIENT_ID_SECRET_PAIRS: undefined,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should throw error when SERVER is missing', () => {
    process.env = {
      ...process.env,
      SERVER: undefined,
      SITE_NAME: 'test-site',
    };

    expect(() => new Config()).toThrow('The environment variable SERVER is not set');
  });

  it('should throw error when SERVER is not HTTPS', () => {
    process.env = {
      ...process.env,
      SERVER: 'http://foo.com',
      SITE_NAME: 'test-site',
    };

    expect(() => new Config()).toThrow(
      'The environment variable SERVER must start with "https://": http://foo.com',
    );
  });

  it('should throw error when SERVER is not a valid URL', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://',
      SITE_NAME: 'test-site',
    };

    expect(() => new Config()).toThrow(
      'The environment variable SERVER is not a valid URL: https:// -- Invalid URL',
    );
  });

  it('should set siteName to empty string when SITE_NAME is "${user_config.site_name}"', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      SITE_NAME: '${user_config.site_name}',
    };

    const config = new Config();
    expect(config.siteName).toBe('');
  });

  it('should throw error when PAT_NAME is missing', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: undefined,
      PAT_VALUE: 'test-pat-value',
    };

    expect(() => new Config()).toThrow('The environment variable PAT_NAME is not set');
  });

  it('should throw error when PAT_VALUE is missing', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: undefined,
    };

    expect(() => new Config()).toThrow('The environment variable PAT_VALUE is not set');
  });

  it('should configure PAT authentication when PAT credentials are provided', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.patName).toBe('test-pat-name');
    expect(config.patValue).toBe('test-pat-value');
    expect(config.siteName).toBe('test-site');
  });

  it('should set default log level to debug when not specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.defaultLogLevel).toBe('debug');
  });

  it('should set custom log level when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      DEFAULT_LOG_LEVEL: 'info',
    };

    const config = new Config();
    expect(config.defaultLogLevel).toBe('info');
  });

  it('should set disableLogMasking to false by default', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.disableLogMasking).toBe(false);
  });

  it('should set disableLogMasking to true when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      DISABLE_LOG_MASKING: 'true',
    };

    const config = new Config();
    expect(config.disableLogMasking).toBe(true);
  });

  it('should set maxResultLimit to null when not specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(null);
  });

  it('should set maxResultLimit to null when specified as a non-number', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      MAX_RESULT_LIMIT: 'abc',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(null);
  });

  it('should set maxResultLimit to null when specified as a negative number', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      MAX_RESULT_LIMIT: '-100',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(null);
  });

  it('should set maxResultLimit to the specified value when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      MAX_RESULT_LIMIT: '100',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(100);
  });

  it('should set disableQueryDatasourceValidationRequests to false by default', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.disableQueryDatasourceValidationRequests).toBe(false);
  });

  it('should set disableQueryDatasourceValidationRequests to true when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS: 'true',
    };

    const config = new Config();
    expect(config.disableQueryDatasourceValidationRequests).toBe(true);
  });

  it('should set disableMetadataApiRequests to false by default', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.disableMetadataApiRequests).toBe(false);
  });

  it('should set disableMetadataApiRequests to true when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      DISABLE_METADATA_API_REQUESTS: 'true',
    };

    const config = new Config();
    expect(config.disableMetadataApiRequests).toBe(true);
  });

  it('should set disableSessionManagement to false by default', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.disableSessionManagement).toBe(false);
  });

  it('should set disableMetadataApiRequests to true when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      DISABLE_SESSION_MANAGEMENT: 'true',
    };

    const config = new Config();
    expect(config.disableSessionManagement).toBe(true);
  });

  it('should default transport to stdio when not specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.transport).toBe('stdio');
  });

  it('should set transport to http when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      TRANSPORT: 'http',
      DANGEROUSLY_DISABLE_OAUTH: 'true',
    };

    const config = new Config();
    expect(config.transport).toBe('http');
  });

  it('should set tableauServerVersionCheckIntervalInHours to default when not specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: undefined,
    };

    const config = new Config();
    expect(config.tableauServerVersionCheckIntervalInHours).toBe(1);
  });

  it('should set tableauServerVersionCheckIntervalInHours to the specified value when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS: '2',
    };

    const config = new Config();
    expect(config.tableauServerVersionCheckIntervalInHours).toBe(2);
  });

  describe('Tool filtering', () => {
    it('should set empty arrays for includeTools and excludeTools when not specified', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.includeTools).toEqual([]);
      expect(config.excludeTools).toEqual([]);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_TOOLS: 'query-datasource,get-datasource-metadata',
      };

      const config = new Config();
      expect(config.includeTools).toEqual(['query-datasource', 'get-datasource-metadata']);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names when tool group names are used', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_TOOLS: 'query-datasource,workbook',
      };

      const config = new Config();
      expect(config.includeTools).toEqual(['query-datasource', 'list-workbooks', 'get-workbook']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        EXCLUDE_TOOLS: 'query-datasource',
      };

      const config = new Config();
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names when tool group names are used', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        EXCLUDE_TOOLS: 'query-datasource,workbook',
      };

      const config = new Config();
      expect(config.excludeTools).toEqual(['query-datasource', 'list-workbooks', 'get-workbook']);
    });

    it('should filter out invalid tool names from INCLUDE_TOOLS', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_TOOLS: 'query-datasource,order-hamburgers',
      };

      const config = new Config();
      expect(config.includeTools).toEqual(['query-datasource']);
    });

    it('should filter out invalid tool names from EXCLUDE_TOOLS', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        EXCLUDE_TOOLS: 'query-datasource,order-hamburgers',
      };

      const config = new Config();
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_TOOLS: 'query-datasource',
        EXCLUDE_TOOLS: 'get-datasource-metadata',
      };

      expect(() => new Config()).toThrow('Cannot include and exclude tools simultaneously');
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified with tool group names', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_TOOLS: 'datasource',
        EXCLUDE_TOOLS: 'workbook',
      };
      expect(() => new Config()).toThrow('Cannot include and exclude tools simultaneously');
    });
  });

  describe('HTTP server config parsing', () => {
    it('should set sslKey to default when SSL_KEY is not set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.sslKey).toBe('');
    });

    it('should set sslKey to the specified value when SSL_KEY is set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        SSL_KEY: 'path/to/ssl-key.pem',
      };

      const config = new Config();
      expect(config.sslKey).toBe('path/to/ssl-key.pem');
    });

    it('should set sslCert to default when SSL_CERT is not set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.sslCert).toBe('');
    });

    it('should set sslCert to the specified value when SSL_CERT is set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        SSL_CERT: 'path/to/ssl-cert.pem',
      };

      const config = new Config();
      expect(config.sslCert).toBe('path/to/ssl-cert.pem');
    });

    it('should set httpPort to default when HTTP_PORT_ENV_VAR_NAME and PORT are not set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });

    it('should set httpPort to the value of PORT when set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        PORT: '8080',
      };

      const config = new Config();
      expect(config.httpPort).toBe(8080);
    });

    it('should set httpPort to the value of the environment variable specified by HTTP_PORT_ENV_VAR_NAME when set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        HTTP_PORT_ENV_VAR_NAME: 'CUSTOM_PORT',
        CUSTOM_PORT: '41664',
      };

      const config = new Config();
      expect(config.httpPort).toBe(41664);
    });

    it('should set httpPort to default when HTTP_PORT_ENV_VAR_NAME is set and custom port is not set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        HTTP_PORT_ENV_VAR_NAME: 'CUSTOM_PORT',
      };

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });

    it('should set httpPort to default when PORT is set to an invalid value', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        PORT: 'invalid',
      };

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });

    it('should set httpPort to default when HTTP_PORT_ENV_VAR_NAME is set and custom port is invalid', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        HTTP_PORT_ENV_VAR_NAME: 'CUSTOM_PORT',
        CUSTOM_PORT: 'invalid',
      };

      const config = new Config();
      expect(config.httpPort).toBe(3927);
    });
  });

  describe('CORS origin config parsing', () => {
    it('should set corsOriginConfig to true when CORS_ORIGIN_CONFIG is not set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.corsOriginConfig).toBe(true);
    });

    it('should set corsOriginConfig to true when CORS_ORIGIN_CONFIG is "true"', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: 'true',
      };

      const config = new Config();
      expect(config.corsOriginConfig).toBe(true);
    });

    it('should set corsOriginConfig to "*" when CORS_ORIGIN_CONFIG is "*"', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: '*',
      };

      const config = new Config();
      expect(config.corsOriginConfig).toBe('*');
    });

    it('should set corsOriginConfig to false when CORS_ORIGIN_CONFIG is "false"', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: 'false',
      };

      const config = new Config();
      expect(config.corsOriginConfig).toBe(false);
    });

    it('should set corsOriginConfig to the specified origin when CORS_ORIGIN_CONFIG is a valid URL', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: 'https://example.com:8080',
      };

      const config = new Config();
      expect(config.corsOriginConfig).toBe('https://example.com:8080');
    });

    it('should set corsOriginConfig to the specified origins when CORS_ORIGIN_CONFIG is an array of URLs', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: '["https://example.com", "https://example.org"]',
      };

      const config = new Config();
      expect(config.corsOriginConfig).toEqual(['https://example.com', 'https://example.org']);
    });

    it('should throw error when CORS_ORIGIN_CONFIG is not a valid URL', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: 'invalid',
      };

      expect(() => new Config()).toThrow(
        'The environment variable CORS_ORIGIN_CONFIG is not a valid URL: invalid',
      );
    });

    it('should throw error when CORS_ORIGIN_CONFIG is not a valid array of URLs', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        CORS_ORIGIN_CONFIG: '["https://example.com", "invalid"]',
      };

      expect(() => new Config()).toThrow(
        'The environment variable CORS_ORIGIN_CONFIG is not a valid array of URLs: ["https://example.com", "invalid"]',
      );
    });
  });

  describe('Trust proxy config parsing', () => {
    it('should set trustProxyConfig to null when TRUST_PROXY_CONFIG is not set', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.trustProxyConfig).toBe(null);
    });

    it('should set trustProxyConfig to true when TRUST_PROXY_CONFIG is "true"', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        TRUST_PROXY_CONFIG: 'true',
      };

      const config = new Config();
      expect(config.trustProxyConfig).toBe(true);
    });

    it('should set trustProxyConfig to false when TRUST_PROXY_CONFIG is "false"', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        TRUST_PROXY_CONFIG: 'false',
      };

      const config = new Config();
      expect(config.trustProxyConfig).toBe(false);
    });

    it('should set trustProxyConfig to the specified number when TRUST_PROXY_CONFIG is a valid number', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        TRUST_PROXY_CONFIG: '1',
      };

      const config = new Config();
      expect(config.trustProxyConfig).toBe(1);
    });

    it('should set trustProxyConfig to the specified string when TRUST_PROXY_CONFIG is a valid string', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        TRUST_PROXY_CONFIG: 'loopback, linklocal, uniquelocal',
      };

      const config = new Config();
      expect(config.trustProxyConfig).toBe('loopback, linklocal, uniquelocal');
    });
  });

  describe('Connected App config parsing', () => {
    const defaultDirectTrustEnvVars = {
      ...defaultEnvVars,
      AUTH: 'direct-trust',
      JWT_SUB_CLAIM: 'test-jwt-sub-claim',
      CONNECTED_APP_CLIENT_ID: 'test-client-id',
      CONNECTED_APP_SECRET_ID: 'test-secret-id',
      CONNECTED_APP_SECRET_VALUE: 'test-secret-value',
    } as const;

    it('should configure direct-trust authentication when all required variables are provided', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
      };

      const config = new Config();
      expect(config.auth).toBe('direct-trust');
      expect(config.jwtUsername).toBe('test-jwt-sub-claim');
      expect(config.connectedAppClientId).toBe('test-client-id');
      expect(config.connectedAppSecretId).toBe('test-secret-id');
      expect(config.connectedAppSecretValue).toBe('test-secret-value');
      expect(config.jwtAdditionalPayload).toBe('{}');
    });

    it('should set jwtAdditionalPayload to the specified value when JWT_ADDITIONAL_PAYLOAD is set', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
        JWT_ADDITIONAL_PAYLOAD: '{"custom":"payload"}',
      };

      const config = new Config();
      expect(JSON.parse(config.jwtAdditionalPayload)).toEqual({ custom: 'payload' });
    });

    it('should throw error when JWT_SUB_CLAIM is missing for direct-trust auth', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
        JWT_SUB_CLAIM: undefined,
      };

      expect(() => new Config()).toThrow('The environment variable JWT_SUB_CLAIM is not set');
    });

    it('should throw error when CONNECTED_APP_CLIENT_ID is missing for direct-trust auth', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
        CONNECTED_APP_CLIENT_ID: undefined,
      };

      expect(() => new Config()).toThrow(
        'The environment variable CONNECTED_APP_CLIENT_ID is not set',
      );
    });

    it('should throw error when CONNECTED_APP_SECRET_ID is missing for direct-trust auth', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
        CONNECTED_APP_SECRET_ID: undefined,
      };

      expect(() => new Config()).toThrow(
        'The environment variable CONNECTED_APP_SECRET_ID is not set',
      );
    });

    it('should throw error when CONNECTED_APP_SECRET_VALUE is missing for direct-trust auth', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
        CONNECTED_APP_SECRET_VALUE: undefined,
      };

      expect(() => new Config()).toThrow(
        'The environment variable CONNECTED_APP_SECRET_VALUE is not set',
      );
    });

    it('should allow PAT_NAME and PAT_VALUE to be empty when AUTH is "direct-trust"', () => {
      process.env = {
        ...process.env,
        ...defaultDirectTrustEnvVars,
        PAT_NAME: undefined,
        PAT_VALUE: undefined,
      };

      const config = new Config();
      expect(config.patName).toBe('');
      expect(config.patValue).toBe('');
    });

    it('should allow all direct-trust fields to be empty when AUTH is not "direct-trust"', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        AUTH: 'pat',
      };

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
    const defaultUatEnvVars = {
      ...defaultEnvVars,
      AUTH: 'uat',
      UAT_TENANT_ID: 'test-tenant-id',
      UAT_ISSUER: 'test-issuer',
      UAT_USERNAME_CLAIM: 'test-username',
      UAT_PRIVATE_KEY: 'test-private-key',
      UAT_KEY_ID: 'test-key-id',
    } as const;

    it('should configure uat authentication when all required variables are provided', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
      };

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
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_USERNAME_CLAIM: undefined,
        JWT_SUB_CLAIM: 'test-jwt-sub-claim',
      };

      const config = new Config();
      expect(config.jwtUsername).toBe('test-jwt-sub-claim');
    });

    it('should set uatUsernameClaimName to the specified value when UAT_USERNAME_CLAIM_NAME is set', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_USERNAME_CLAIM_NAME: 'test-username-claim-name',
      };

      const config = new Config();
      expect(config.uatUsernameClaimName).toBe('test-username-claim-name');
    });

    it('should throw error when UAT_TENANT_ID is missing', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_TENANT_ID: undefined,
      };

      expect(() => new Config()).toThrow('The environment variable UAT_TENANT_ID is not set');
    });

    it('should throw error when UAT_ISSUER is missing', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_ISSUER: undefined,
      };

      expect(() => new Config()).toThrow('The environment variable UAT_ISSUER is not set');
    });

    it('should throw error when UAT_USERNAME_CLAIM is missing and JWT_SUB_CLAIM is not set', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_USERNAME_CLAIM: undefined,
        JWT_SUB_CLAIM: undefined,
      };

      expect(() => new Config()).toThrow(
        'One of the environment variables: UAT_USERNAME_CLAIM or JWT_SUB_CLAIM must be set',
      );
    });

    it('should throw error when UAT_PRIVATE_KEY and UAT_PRIVATE_KEY_PATH is not set', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_PRIVATE_KEY: undefined,
        UAT_PRIVATE_KEY_PATH: undefined,
      };

      expect(() => new Config()).toThrow(
        'One of the environment variables: UAT_PRIVATE_KEY_PATH or UAT_PRIVATE_KEY must be set',
      );
    });

    it('should throw error when UAT_PRIVATE_KEY and UAT_PRIVATE_KEY_PATH are both set', () => {
      process.env = {
        ...process.env,
        ...defaultUatEnvVars,
        UAT_PRIVATE_KEY: 'hamburgers',
        UAT_PRIVATE_KEY_PATH: 'hotdogs',
      };

      expect(() => new Config()).toThrow(
        'Only one of the environment variables: UAT_PRIVATE_KEY or UAT_PRIVATE_KEY_PATH must be set',
      );
    });
  });

  describe('Bounded context parsing', () => {
    it('should set boundedContext to null sets when no project, datasource, or workbook IDs are provided', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.boundedContext).toEqual({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
      });
    });

    it('should set boundedContext to the specified project, datasource, and workbook IDs when provided', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_PROJECT_IDS: ' 123, 456, 123   ', // spacing is intentional here to test trimming
        INCLUDE_DATASOURCE_IDS: '789,101',
        INCLUDE_WORKBOOK_IDS: '112,113',
      };

      const config = new Config();
      expect(config.boundedContext).toEqual({
        projectIds: new Set(['123', '456']),
        datasourceIds: new Set(['789', '101']),
        workbookIds: new Set(['112', '113']),
      });
    });

    it('should throw error when INCLUDE_PROJECT_IDS is set to an empty string', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_PROJECT_IDS: '',
      };

      expect(() => new Config()).toThrow(
        'When set, the environment variable INCLUDE_PROJECT_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_DATASOURCE_IDS is set to an empty string', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_DATASOURCE_IDS: '',
      };

      expect(() => new Config()).toThrow(
        'When set, the environment variable INCLUDE_DATASOURCE_IDS must have at least one value',
      );
    });

    it('should throw error when INCLUDE_WORKBOOK_IDS is set to an empty string', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
        INCLUDE_WORKBOOK_IDS: '',
      };

      expect(() => new Config()).toThrow(
        'When set, the environment variable INCLUDE_WORKBOOK_IDS must have at least one value',
      );
    });
  });

  describe('OAuth configuration', () => {
    const defaultOAuthEnvVars = {
      ...defaultEnvVars,
      OAUTH_ISSUER: 'https://example.com',
      OAUTH_JWE_PRIVATE_KEY_PATH: 'path/to/private.pem',
    } as const;

    const defaultOAuthTimeoutMs = {
      authzCodeTimeoutMs: 10 * 60 * 1000,
      accessTokenTimeoutMs: 1 * 60 * 60 * 1000,
      refreshTokenTimeoutMs: 30 * 24 * 60 * 60 * 1000,
    };

    const defaultOAuthConfig = {
      enabled: true,
      clientIdSecretPairs: null,
      issuer: defaultOAuthEnvVars.OAUTH_ISSUER,
      redirectUri: `${defaultOAuthEnvVars.OAUTH_ISSUER}/Callback`,
      jwePrivateKey: '',
      jwePrivateKeyPath: defaultOAuthEnvVars.OAUTH_JWE_PRIVATE_KEY_PATH,
      jwePrivateKeyPassphrase: undefined,
      dnsServers: ['1.1.1.1', '1.0.0.1'],
      ...defaultOAuthTimeoutMs,
    } as const;

    it('should default to disabled', () => {
      process.env = {
        ...process.env,
        ...defaultEnvVars,
      };

      const config = new Config();
      expect(config.oauth).toEqual({
        enabled: false,
        issuer: '',
        clientIdSecretPairs: null,
        redirectUri: '',
        jwePrivateKey: '',
        jwePrivateKeyPath: '',
        jwePrivateKeyPassphrase: undefined,
        dnsServers: ['1.1.1.1', '1.0.0.1'],
        ...defaultOAuthTimeoutMs,
      });
    });

    it('should enable OAuth when OAUTH_ISSUER is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
      };

      const config = new Config();
      expect(config.oauth).toEqual(defaultOAuthConfig);
    });

    it('should disable OAuth when DANGEROUSLY_DISABLE_OAUTH is "true"', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        DANGEROUSLY_DISABLE_OAUTH: 'true',
      };

      const config = new Config();
      expect(config.oauth.enabled).toEqual(false);
    });

    it('should set redirectUri to the specified value when OAUTH_REDIRECT_URI is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_REDIRECT_URI: 'https://example.com/CustomCallback',
      };

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        redirectUri: 'https://example.com/CustomCallback',
      });
    });

    it('should set redirectUri to the default value when OAUTH_REDIRECT_URI is not set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_REDIRECT_URI: '',
      };

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        redirectUri: `${defaultOAuthEnvVars.OAUTH_ISSUER}/Callback`,
      });
    });

    it('should set jwePrivateKey to the specified value when OAUTH_JWE_PRIVATE_KEY is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_JWE_PRIVATE_KEY: 'hamburgers',
        OAUTH_JWE_PRIVATE_KEY_PATH: '',
      };

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        jwePrivateKey: 'hamburgers',
        jwePrivateKeyPath: '',
        jwePrivateKeyPassphrase: undefined,
      });
    });

    it('should set authzCodeTimeoutMs to the specified value when OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS: '5678',
      };

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        authzCodeTimeoutMs: 5678,
      });
    });

    it('should set accessTokenTimeoutMs to the specified value when OAUTH_ACCESS_TOKEN_TIMEOUT_MS is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_ACCESS_TOKEN_TIMEOUT_MS: '1234',
      };

      const config = new Config();
      expect(config.oauth).toEqual({
        ...defaultOAuthConfig,
        accessTokenTimeoutMs: 1234,
      });
    });

    it('should set refreshTokenTimeoutMs to the specified value when OAUTH_REFRESH_TOKEN_TIMEOUT_MS is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_REFRESH_TOKEN_TIMEOUT_MS: '1234',
      };

      const config = new Config();
      expect(config.oauth.refreshTokenTimeoutMs).toBe(1234);
    });

    it('should throw error when TRANSPORT is "http" and OAUTH_ISSUER is not set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        TRANSPORT: 'http',
        OAUTH_ISSUER: undefined,
      };

      expect(() => new Config()).toThrow(
        'OAUTH_ISSUER must be set when TRANSPORT is "http" unless DANGEROUSLY_DISABLE_OAUTH is "true"',
      );
    });

    it('should throw error when OAUTH_JWE_PRIVATE_KEY and OAUTH_JWE_PRIVATE_KEY_PATH is not set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_JWE_PRIVATE_KEY_PATH: '',
      };

      expect(() => new Config()).toThrow(
        'One of the environment variables: OAUTH_JWE_PRIVATE_KEY_PATH or OAUTH_JWE_PRIVATE_KEY must be set',
      );
    });

    it('should throw error when OAUTH_JWE_PRIVATE_KEY and OAUTH_JWE_PRIVATE_KEY_PATH are both set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_JWE_PRIVATE_KEY: 'hamburgers',
        OAUTH_JWE_PRIVATE_KEY_PATH: 'hotdogs',
      };

      expect(() => new Config()).toThrow(
        'Only one of the environment variables: OAUTH_JWE_PRIVATE_KEY or OAUTH_JWE_PRIVATE_KEY_PATH must be set',
      );
    });

    it('should throw error when AUTH is "oauth" and OAUTH_ISSUER is not set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        AUTH: 'oauth',
        OAUTH_ISSUER: '',
      };

      expect(() => new Config()).toThrow('When AUTH is "oauth", OAUTH_ISSUER must be set');
    });

    it('should throw error when AUTH is "oauth" and DANGEROUSLY_DISABLE_OAUTH is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        AUTH: 'oauth',
        DANGEROUSLY_DISABLE_OAUTH: 'true',
      };

      expect(() => new Config()).toThrow(
        'When AUTH is "oauth", DANGEROUSLY_DISABLE_OAUTH cannot be "true"',
      );
    });

    it('should default transport to "http" when OAUTH_ISSUER is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        TRANSPORT: undefined,
      };

      const config = new Config();
      expect(config.transport).toBe('http');
    });

    it('should default auth to "oauth" when OAUTH_ISSUER is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
      };

      const config = new Config();
      expect(config.auth).toBe('oauth');
    });

    it('should throw error when transport is stdio and auth is "oauth"', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        TRANSPORT: 'stdio',
      };

      expect(() => new Config()).toThrow('TRANSPORT must be "http" when OAUTH_ISSUER is set');
    });

    it('should allow PAT_NAME and PAT_VALUE to be empty when AUTH is "oauth"', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        PAT_NAME: undefined,
        PAT_VALUE: undefined,
        AUTH: 'oauth',
      };

      const config = new Config();
      expect(config.patName).toBe('');
      expect(config.patValue).toBe('');
    });

    it('should allow SITE_NAME to be empty when AUTH is "oauth"', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        AUTH: 'oauth',
        SITE_NAME: '',
      };

      const config = new Config();
      expect(config.siteName).toBe('');
    });

    it('should set clientIdSecretPairs to the specified value when OAUTH_CLIENT_ID_SECRET_PAIRS is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_CLIENT_ID_SECRET_PAIRS: 'client1:secret1,client2:secret2',
      };

      const config = new Config();
      expect(config.oauth.clientIdSecretPairs).toEqual({
        client1: 'secret1',
        client2: 'secret2',
      });
    });

    it('should set dnsServers to the specified value when OAUTH_CIMD_DNS_SERVERS is set', () => {
      process.env = {
        ...process.env,
        ...defaultOAuthEnvVars,
        OAUTH_CIMD_DNS_SERVERS: '8.8.8.8,8.8.4.4',
      };

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
