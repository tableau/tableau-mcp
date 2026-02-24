import { CapabilityCatalog } from '../../codemode/capabilityCatalog.js';

import { buildCodeModeSpec } from './common.js';

describe('buildCodeModeSpec', () => {
  it('builds an operationId-keyed map and compatibility aliases', () => {
    const catalog = {
      operations: [
        {
          operationId: 'listDatasources',
          toolName: 'list-datasources',
          group: null,
          description: 'List datasources',
          annotations: undefined,
          parameters: [],
        },
        {
          operationId: 'searchContent',
          toolName: 'search-content',
          group: null,
          description: 'Search content',
          annotations: undefined,
          parameters: [],
        },
      ],
      operationMap: {
        listDatasources: 'list-datasources',
        searchContent: 'search-content',
      },
      byToolName: {} as CapabilityCatalog['byToolName'],
    } as CapabilityCatalog;

    const spec = buildCodeModeSpec(catalog);

    expect(Object.keys(spec.operations)).toEqual(['listDatasources', 'searchContent']);
    expect(spec.operationList).toHaveLength(2);
    expect(spec.operationIds).toEqual(['listDatasources', 'searchContent']);
    expect(spec.paths).toEqual({});
  });
});
