import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportedForTesting } from './config.js';

describe('Config', () => {
  const { Config } = exportedForTesting;

  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      SERVER: undefined,
      DATASOURCE_LUID: undefined,
      SITE_NAME: undefined,
      PAT_NAME: undefined,
      PAT_VALUE: undefined,
      JWT: undefined,
      USERNAME: undefined,
      PASSWORD: undefined,
      CONNECTED_APP_CLIENT_ID: undefined,
      CONNECTED_APP_SECRET_ID: undefined,
      CONNECTED_APP_SECRET_VALUE: undefined,
      JWT_SCOPES: undefined,
      AUTH_TYPE: undefined,
      DEFAULT_LOG_LEVEL: undefined,
      DISABLE_LOG_MASKING: undefined,
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

  it('should throw error when DATASOURCE_LUID is missing', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: undefined,
    };

    expect(() => new Config()).toThrow('The environment variable DATASOURCE_LUID is not set');
  });

  it('should throw error when SITE_NAME is not set', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
      SITE_NAME: undefined,
    };

    expect(() => new Config()).toThrow('The environment variable SITE_NAME is not set');
  });

  it('should throw error when no credentials are provided', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
      SITE_NAME: 'test-site',
    };

    expect(() => new Config()).toThrow(
      'No authentication method could be determined. Ensure the environment variables are set.',
    );
  });

  it('should configure PAT authentication when PAT credentials are provided', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
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

  it('should configure JWT authentication when JWT is provided', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
      SITE_NAME: 'test-site',
      JWT: 'test-jwt',
    };

    const config = new Config();
    expect(config.authConfig).toEqual({
      type: 'jwt',
      jwt: 'test-jwt',
      siteName: 'test-site',
    });
  });

  it('should configure direct-trust authentication when all required credentials are provided', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
      SITE_NAME: 'test-site',
      USERNAME: 'test-user',
      CONNECTED_APP_CLIENT_ID: 'test-client-id',
      CONNECTED_APP_SECRET_ID: 'test-secret-id',
      CONNECTED_APP_SECRET_VALUE: 'test-secret-value',
      JWT_SCOPES: 'tableau:books:read',
    };

    const config = new Config();
    expect(config.authConfig).toEqual({
      type: 'direct-trust',
      username: 'test-user',
      clientId: 'test-client-id',
      secretId: 'test-secret-id',
      secretValue: 'test-secret-value',
      siteName: 'test-site',
      scopes: ['tableau:viz_data_service:read', 'tableau:content:read', 'tableau:books:read'],
    });
  });

  it('should configure username-password authentication when credentials are provided', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
      SITE_NAME: 'test-site',
      USERNAME: 'test-user',
      PASSWORD: 'test-password',
    };

    const config = new Config();
    expect(config.authConfig).toEqual({
      type: 'username-password',
      username: 'test-user',
      password: 'test-password',
      siteName: 'test-site',
    });
  });

  it('should set default log level to debug when not specified', () => {
    process.env = {
      ...process.env,
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
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
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
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
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
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
      SERVER: 'test-server',
      DATASOURCE_LUID: 'test-luid',
      SITE_NAME: 'test-site',
      PAT_NAME: 'test-pat-name',
      PAT_VALUE: 'test-pat-value',
      DISABLE_LOG_MASKING: 'true',
    };

    const config = new Config();
    expect(config.disableLogMasking).toBe(true);
  });
});
