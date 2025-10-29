import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
import { constrainDatasources, getListDatasourcesTool } from './listDatasources.js';
import { mockDatasources } from './mockDatasources.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listDatasourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listDatasourcesTool = getListDatasourcesTool(new Server());
    expect(listDatasourcesTool.name).toBe('list-datasources');
    expect(listDatasourcesTool.description).toContain('Retrieves a list of published data sources');
    expect(listDatasourcesTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully list datasources', async () => {
    mocks.mockListDatasources.mockResolvedValue(mockDatasources);
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListDatasources.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('constrainDatasources', () => {
    it('should return empty result when no datasources are found', () => {
      const result = constrainDatasources({
        datasources: [],
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No datasources were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all datasources were filtered out by the bounded context', () => {
      const result = constrainDatasources({
        datasources: mockDatasources.datasources,
        boundedContext: { projectIds: new Set(['123']), datasourceIds: null, workbookIds: null },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          'While data sources were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    it('should return success result when no datasources were filtered out by the bounded context', () => {
      const result = constrainDatasources({
        datasources: mockDatasources.datasources,
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
      });

      invariant(result.type === 'success');
      expect(result.result).toBe(mockDatasources.datasources);
    });

    it('should return success result when some datasources were filtered out by a bounded context with a project filter', () => {
      const result = constrainDatasources({
        datasources: mockDatasources.datasources,
        boundedContext: {
          projectIds: new Set([mockDatasources.datasources[0].project.id]),
          datasourceIds: null,
          workbookIds: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockDatasources.datasources[0]]);
    });

    it('should return success result when some datasources were filtered out by a bounded context including both project and datasource filters', () => {
      const result = constrainDatasources({
        datasources: mockDatasources.datasources,
        boundedContext: {
          projectIds: new Set([mockDatasources.datasources[0].project.id]),
          datasourceIds: new Set([mockDatasources.datasources[0].id]),
          workbookIds: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockDatasources.datasources[0]]);
    });
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listDatasourcesTool = getListDatasourcesTool(new Server());
  return await listDatasourcesTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
