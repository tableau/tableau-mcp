import { describe, expect, it } from 'vitest';

import { datasourcesApis } from './datasourcesApi.js';

const rowWithoutProject = {
  owner: { id: 'bbdee366-4a50-4c2c-a5c8-746da5b64483' },
  tags: {},
  contentUrl: 'DeletedDatasource',
  createdAt: '2026-10-19T23:03:45Z',
  encryptExtracts: 'false',
  hasExtracts: false,
  hasSemanticLayerConnection: false,
  id: '3d4c7c20-c0b9-4880-a225-9bdc657b21f8',
  isCertified: false,
  name: 'Deleted Datasource',
  size: '1',
  type: 'hyper',
  updatedAt: '2026-10-19T23:03:45Z',
  useRemoteQueryAgent: false,
  webpageUrl: 'https://example.online.tableau.com/#/site/s/datasources/32765663',
};

const rowWithProject = {
  ...rowWithoutProject,
  id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45',
  name: 'Superstore Datasource',
  project: { id: 'cbec32db-a4a2-4308-b5f0-4fc67322f359', name: 'Samples' },
};

describe('listDatasources response', () => {
  it('parses a page that includes a row without a project', () => {
    const endpoint = datasourcesApis.find(({ alias }) => alias === 'listDatasources');
    if (!endpoint) throw new Error('listDatasources endpoint not found');

    const parsed = endpoint.response.parse({
      pagination: { pageNumber: '1', pageSize: '100', totalAvailable: '2' },
      datasources: { datasource: [rowWithProject, rowWithoutProject] },
    }) as { datasources: { datasource?: Array<{ id: string; project?: unknown }> } };

    expect(parsed.datasources.datasource?.map((d) => d.id)).toEqual([
      rowWithProject.id,
      rowWithoutProject.id,
    ]);
    expect(parsed.datasources.datasource?.[1].project).toBeUndefined();
  });
});
