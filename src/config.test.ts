import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportedForTesting } from './config.js';

describe('Config', () => {
  const { Config } = exportedForTesting;

  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      TRANSPORT: undefined,
      PORT: undefined,
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
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
    };

    const config = new Config();
    expect(config.authConfig).toEqual({
      type: 'pat',
      patName: 'test-pat-name',
      patValue: 'test-pat-value',
      siteName: 'test-site',
    });
  });

  it('should set default log level to debug when not specified', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
    };

    const config = new Config();
    expect(config.defaultLogLevel).toBe('debug');
  });

  it('should set custom log level when specified', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      DEFAULT_LOG_LEVEL: 'info',
    };

    const config = new Config();
    expect(config.defaultLogLevel).toBe('info');
  });

  it('should set disableLogMasking to false by default', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
    };

    const config = new Config();
    expect(config.disableLogMasking).toBe(false);
  });

  it('should set disableLogMasking to true when specified', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      DISABLE_LOG_MASKING: 'true',
    };

    const config = new Config();
    expect(config.disableLogMasking).toBe(true);
  });

  it('should set maxResultLimit to null when not specified', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(null);
  });

  it('should set maxResultLimit to null when specified as a non-number', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      MAX_RESULT_LIMIT: 'abc',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(null);
  });

  it('should set maxResultLimit to null when specified as a negative number', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      MAX_RESULT_LIMIT: '-100',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(null);
  });

  it('should set maxResultLimit to the specified value when specified', () => {
    process.env = {
      ...process.env,
      SERVER: 'https://test-server.com',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      MAX_RESULT_LIMIT: '100',
    };

    const config = new Config();
    expect(config.maxResultLimit).toBe(100);
  });

  describe('Tool filtering', () => {
    it('should set empty arrays for includeTools and excludeTools when not specified', () => {
      process.env = {
        ...process.env,
        SERVER: 'https://test-server.com',
        SITE_NAME: 'test-site',
        PAT_NAME: 'test-pat-name',
        PAT_VALUE: 'test-pat-value',
      };

      const config = new Config();
      expect(config.includeTools).toEqual([]);
      expect(config.excludeTools).toEqual([]);
    });

    it('should parse INCLUDE_TOOLS into an array of valid tool names', () => {
      process.env = {
        ...process.env,
        SERVER: 'https://test-server.com',
        SITE_NAME: 'test-site',
        PAT_NAME: 'test-pat-name',
        PAT_VALUE: 'test-pat-value',
        INCLUDE_TOOLS: 'query-datasource,list-fields',
      };

      const config = new Config();
      expect(config.includeTools).toEqual(['query-datasource', 'list-fields']);
    });

    it('should parse EXCLUDE_TOOLS into an array of valid tool names', () => {
      process.env = {
        ...process.env,
        SERVER: 'https://test-server.com',
        SITE_NAME: 'test-site',
        PAT_NAME: 'test-pat-name',
        PAT_VALUE: 'test-pat-value',
        EXCLUDE_TOOLS: 'query-datasource',
      };

      const config = new Config();
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should filter out invalid tool names from INCLUDE_TOOLS', () => {
      process.env = {
        ...process.env,
        SERVER: 'https://test-server.com',
        SITE_NAME: 'test-site',
        PAT_NAME: 'test-pat-name',
        PAT_VALUE: 'test-pat-value',
        INCLUDE_TOOLS: 'query-datasource,order-hamburgers',
      };

      const config = new Config();
      expect(config.includeTools).toEqual(['query-datasource']);
    });

    it('should filter out invalid tool names from EXCLUDE_TOOLS', () => {
      process.env = {
        ...process.env,
        SERVER: 'https://test-server.com',
        SITE_NAME: 'test-site',
        PAT_NAME: 'test-pat-name',
        PAT_VALUE: 'test-pat-value',
        EXCLUDE_TOOLS: 'query-datasource,order-hamburgers',
      };

      const config = new Config();
      expect(config.excludeTools).toEqual(['query-datasource']);
    });

    it('should throw error when both INCLUDE_TOOLS and EXCLUDE_TOOLS are specified', () => {
      process.env = {
        ...process.env,
        SERVER: 'https://test-server.com',
        SITE_NAME: 'test-site',
        PAT_NAME: 'test-pat-name',
        PAT_VALUE: 'test-pat-value',
        INCLUDE_TOOLS: 'query-datasource',
        EXCLUDE_TOOLS: 'list-fields',
      };

      expect(() => new Config()).toThrow('Cannot specify both INCLUDE_TOOLS and EXCLUDE_TOOLS');
    });
  });
});
