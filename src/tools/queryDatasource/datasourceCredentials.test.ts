import { exportedForTesting as configExportedForTesting } from '../../config.js';
import {
  exportedForTesting as datasourceCredentialsExportedForTesting,
  getDatasourceCredentials,
} from './datasourceCredentials.js';

const { resetConfig } = configExportedForTesting;
const { resetDatasourceCredentials } = datasourceCredentialsExportedForTesting;

describe('getDatasourceCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    resetDatasourceCredentials();
    process.env = {
      ...originalEnv,
      DATASOURCE_CREDENTIALS: undefined,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return undefined when DATASOURCE_CREDENTIALS is not set', () => {
    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should return undefined when DATASOURCE_CREDENTIALS is empty', () => {
    process.env.DATASOURCE_CREDENTIALS = '';
    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should return credentials for a valid datasource LUID', () => {
    process.env.DATASOURCE_CREDENTIALS = JSON.stringify({
      'test-luid': { u: 'test-user', p: 'test-pass' },
    });

    expect(getDatasourceCredentials('test-luid')).toEqual({
      username: 'test-user',
      password: 'test-pass',
    });
  });

  it('should return undefined for a non-existent datasource LUID', () => {
    process.env.DATASOURCE_CREDENTIALS = JSON.stringify({
      'other-luid': { u: 'test-user', p: 'test-pass' },
    });

    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should throw error when DATASOURCE_CREDENTIALS is invalid JSON', () => {
    process.env.DATASOURCE_CREDENTIALS = 'invalid-json';
    expect(() => getDatasourceCredentials('test-luid')).toThrow(
      'Invalid datasource credentials format. Could not parse JSON string: invalid-json',
    );
  });

  it('should throw error when credential schema is invalid', () => {
    process.env.DATASOURCE_CREDENTIALS = JSON.stringify({
      'test-luid': { x: 'test-user', y: 'test-pass' },
    });

    expect(() => getDatasourceCredentials('test-luid')).toThrow();
  });
});
