import { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { projectDatasource } from './datasourceResult.js';

describe('projectDatasource', () => {
  it('returns only approved non-null metadata fields without spreading transport fields', () => {
    const datasource: DatasourceItem = {
      id: 'safe-id',
      luid: null,
      name: 'Safe name',
      caption: 'Safe caption',
      type: 'relational',
      isExtract: false,
      hasDownloadFilePermission: null,
      password: 'do-not-return-password',
      credential: { value: 'do-not-return-credential' },
      token: 'do-not-return-token',
      oauth: { clientSecret: 'do-not-return-oauth-secret' },
      nested: { connection: { password: 'do-not-return-nested-secret' } },
    };

    const result = projectDatasource(datasource);

    expect(result).toEqual({
      id: 'safe-id',
      name: 'Safe name',
      caption: 'Safe caption',
      type: 'relational',
      isExtract: false,
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });

  it('preserves every approved value when present, including false permissions', () => {
    expect(
      projectDatasource({
        id: 'published-id',
        luid: 'published-luid',
        name: 'Published',
        caption: 'Published caption',
        type: 'federated',
        isExtract: true,
        hasDownloadFilePermission: false,
      }),
    ).toEqual({
      id: 'published-id',
      luid: 'published-luid',
      name: 'Published',
      caption: 'Published caption',
      type: 'federated',
      isExtract: true,
      hasDownloadFilePermission: false,
    });
  });

  it('returns an empty object for an older empty transport item', () => {
    expect(projectDatasource({})).toEqual({});
  });
});
