import {
  exportedForTesting as datasourceCredentialsExportedForTesting,
  getDatasourceCredentials,
} from './datasourceCredentials.js';

const { resetDatasourceCredentials } = datasourceCredentialsExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  getConfig: mocks.mockGetConfig,
}));

describe('getDatasourceCredentials', () => {
  beforeEach(() => {
    resetDatasourceCredentials();
    mocks.mockGetConfig.mockReturnValue({
      datasourceCredentials: undefined,
    });
  });

  it('should return undefined when DATASOURCE_CREDENTIALS is not set', () => {
    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should return undefined when DATASOURCE_CREDENTIALS is empty', () => {
    expect(getDatasourceCredentials('test-luid')).toBeUndefined();
  });

  it('should return credentials for a valid datasource LUID', () => {
    mocks.mockGetConfig.mockReturnValue({
      datasourceCredentials: JSON.stringify({
        'ds-luid': [{ luid: 'test-luid', u: 'test-user', p: 'test-pass' }],
      }),
    });

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
    mocks.mockGetConfig.mockReturnValue({
      datasourceCredentials: JSON.stringify({
        'ds-luid': [{ luid: 'test-luid', u: 'test-user', p: 'test-pass' }],
      }),
    });

    expect(getDatasourceCredentials('other-luid')).toBeUndefined();
  });

  it('should throw error when DATASOURCE_CREDENTIALS is invalid JSON', () => {
    mocks.mockGetConfig.mockReturnValue({
      datasourceCredentials: 'invalid-json',
    });

    expect(() => getDatasourceCredentials('test-luid')).toThrow(
      'Invalid datasource credentials format. Could not parse JSON string: invalid-json',
    );
  });

  it('should throw error when credential schema is invalid', () => {
    mocks.mockGetConfig.mockReturnValue({
      datasourceCredentials: JSON.stringify({
        'ds-luid': [{ luid: 'test-luid', x: 'test-user', y: 'test-pass' }],
      }),
    });

    expect(() => getDatasourceCredentials('ds-luid')).toThrow();
  });
});
