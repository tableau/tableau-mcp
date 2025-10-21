import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportedForTesting } from './config.js';

describe('Config', () => {
  const { Config } = exportedForTesting;

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
      DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: undefined,
      DISABLE_METADATA_API_REQUESTS: undefined,
      ENABLE_SERVER_LOGGING: undefined,
      SERVER_LOG_DIRECTORY: undefined,
      INCLUDE_PROJECT_IDS: undefined,
      INCLUDE_DATASOURCE_IDS: undefined,
      INCLUDE_WORKBOOK_IDS: undefined,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should throw error when SERVER is missing', () => {
    process.env = {
      ...process.env,
      SERVER: undefined,
    };

    expect(() => new Config()).toThrow('The environment variable SERVER is not set');
  });

  it('should throw error when SERVER is not HTTPS', () => {
    process.env = {
      ...process.env,
      SERVER: 'http://foo.com',
    };

    expect(() => new Config()).toThrow(
      'The environment variable SERVER must start with "https://": http://foo.com',
    );
  });

  it('should throw error when SERVER is not a valid URL', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://',
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

  it('should set disableQueryDatasourceFilterValidation to false by default', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
    };

    const config = new Config();
    expect(config.disableQueryDatasourceFilterValidation).toBe(false);
  });

  it('should set disableQueryDatasourceFilterValidation to true when specified', () => {
    process.env = {
      ...process.env,
      ...defaultEnvVars,
      DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION: 'true',
    };

    const config = new Config();
    expect(config.disableQueryDatasourceFilterValidation).toBe(true);
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
    };

    const config = new Config();
    expect(config.transport).toBe('http');
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

  describe('HTTP port parsing', () => {
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
      expect(config.jwtSubClaim).toBe('test-jwt-sub-claim');
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
      expect(config.jwtSubClaim).toBe('');
      expect(config.connectedAppClientId).toBe('');
      expect(config.connectedAppSecretId).toBe('');
      expect(config.connectedAppSecretValue).toBe('');
      expect(config.jwtAdditionalPayload).toBe('{}');
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
});
