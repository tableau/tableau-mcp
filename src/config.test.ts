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
      TRANSPORT: undefined,
      HTTP_PORT_ENV_VAR_NAME: undefined,
      PORT: undefined,
      CUSTOM_PORT: undefined,
      CORS_ORIGIN_CONFIG: undefined,
      SERVER: undefined,
      SITE_NAME: undefined,
      PAT_NAME: undefined,
      PAT_VALUE: undefined,
      DATASOURCE_CREDENTIALS: undefined,
      DEFAULT_LOG_LEVEL: undefined,
      DISABLE_LOG_MASKING: undefined,
      INCLUDE_TOOLS: undefined,
      EXCLUDE_TOOLS: undefined,
      MAX_RESULT_LIMIT: undefined,
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
        INCLUDE_TOOLS: 'query-datasource,list-fields',
      };

      const config = new Config();
      expect(config.includeTools).toEqual(['query-datasource', 'list-fields']);
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
        EXCLUDE_TOOLS: 'list-fields',
      };

      expect(() => new Config()).toThrow('Cannot specify both INCLUDE_TOOLS and EXCLUDE_TOOLS');
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
});
