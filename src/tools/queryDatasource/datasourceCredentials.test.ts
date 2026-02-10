import { stubDefaultEnvVars } from '../../testShared.js';
import {
  exportedForTesting as datasourceCredentialsExportedForTesting,
  getDatasourceCredentials,
} from './datasourceCredentials.js';

const { resetDatasourceCredentials } = datasourceCredentialsExportedForTesting;

describe('getDatasourceCredentials', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetDatasourceCredentials();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return undefined when DATASOURCE_CREDENTIALS is not set', () => {
    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should return undefined when DATASOURCE_CREDENTIALS is empty', () => {
    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should return credentials for a valid datasource LUID', () => {
    vi.stubEnv(
      'DATASOURCE_CREDENTIALS',
      JSON.stringify({
        'ds-luid': [{ luid: 'test-luid', u: 'test-user', p: 'test-pass' }],
      }),
    );

    expect(getDatasourceCredentials('ds-luid')).toEqual([
      {
        connectionLuid: 'test-luid',
        connectionUsername: 'test-user',
        connectionPassword: 'test-pass',
      },
    ]);

    // Call it again to ensure the cache is hit
    expect(getDatasourceCredentials('ds-luid')).toEqual([
      {
        connectionLuid: 'test-luid',
        connectionUsername: 'test-user',
        connectionPassword: 'test-pass',
      },
    ]);
  });

  it('should return undefined for a non-existent datasource LUID', () => {
    vi.stubEnv(
      'DATASOURCE_CREDENTIALS',
      JSON.stringify({
        'ds-luid': [{ luid: 'test-luid', u: 'test-user', p: 'test-pass' }],
      }),
    );

    expect(getDatasourceCredentials('other-luid')).toBeUndefined();
  });

  it('should throw error when DATASOURCE_CREDENTIALS is invalid JSON', () => {
    vi.stubEnv('DATASOURCE_CREDENTIALS', 'invalid-json');

    expect(() => getDatasourceCredentials('test-luid')).toThrow(
      'Invalid datasource credentials format. Could not parse JSON string: invalid-json',
    );
  });

  it('should throw error when credential schema is invalid', () => {
    vi.stubEnv(
      'DATASOURCE_CREDENTIALS',
      JSON.stringify({
        'ds-luid': [{ luid: 'test-luid', x: 'test-user', y: 'test-pass' }],
      }),
    );

    expect(() => getDatasourceCredentials('ds-luid')).toThrow();
  });
});
