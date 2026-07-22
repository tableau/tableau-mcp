import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { WebMcpServer } from '../../../server.web.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { constrainDatasources, getListDatasourcesTool } from './listDatasources.js';
import { mockDatasources } from './mockDatasources.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
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
    const listDatasourcesTool = getListDatasourcesTool(new WebMcpServer());
    expect(listDatasourcesTool.name).toBe('list-datasources');
    expect(listDatasourcesTool.description).toContain('Retrieves a list of published data sources');
    expect(listDatasourcesTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully list datasources', async () => {
    mocks.mockListDatasources.mockResolvedValue(mockDatasources);
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Superstore');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.map((d: { name: string }) => d.name)).toContain('Superstore Datasource');
    expect(parsed.totalAvailable).toBe(mockDatasources.pagination.totalAvailable);

    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: 1000,
      pageNumber: 1,
    });
  });

  it('should fetch a single page without looping', async () => {
    // A full page of 1000 items while Tableau reports more available.
    const page = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      name: `Datasource ${i}`,
      project: { id: 'p1', name: 'Project' },
      tags: { tag: [] },
    }));
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      datasources: page,
    });

    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBeLessThanOrEqual(1000);
    expect(parsed.data.length).toBe(1000);
    expect(parsed.totalAvailable).toBe(2600);
    // Single page: the REST method is called exactly once (no looping).
    expect(mocks.mockListDatasources).toHaveBeenCalledTimes(1);
  });

  it('should request the requested pageNumber', async () => {
    mocks.mockListDatasources.mockResolvedValue(mockDatasources);
    await getToolResult({ filter: 'name:eq:Superstore', pageNumber: 3 });
    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: 1000,
      pageNumber: 3,
    });
  });

  it('should trim to the caller limit without capping totalAvailable', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      name: `Datasource ${i}`,
      project: { id: 'p1', name: 'Project' },
      tags: { tag: [] },
    }));
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      datasources: page,
    });

    const result = await getToolResult({ filter: 'name:eq:Superstore', limit: 600 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBe(600);
    // The caller's own limit never caps totalAvailable.
    expect(parsed.totalAvailable).toBe(2600);
    expect(mocks.mockListDatasources).toHaveBeenCalledTimes(1);
  });

  it('should cap totalAvailable when a server maxResultLimit trims the page', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      name: `Datasource ${i}`,
      project: { id: 'p1', name: 'Project' },
      tags: { tag: [] },
    }));
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      datasources: page,
    });

    const extra = getMockRequestHandlerExtra();
    const stubConfig = new OverridableConfig({});
    // Server cap smaller than the page => this page is trimmed and totalAvailable is capped.
    vi.spyOn(stubConfig, 'getMaxResultLimit').mockReturnValue(700);
    vi.mocked(extra.getConfigWithOverrides).mockResolvedValue(stubConfig);

    const result = await getToolResult({ filter: 'name:eq:Superstore' }, extra);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBe(700);
    expect(parsed.totalAvailable).toBe(700);
    expect(mocks.mockListDatasources).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListDatasources.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('constrainDatasources', () => {
    it('should return empty result when no datasources are found', () => {
      const result = constrainDatasources({
        datasources: [],
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No datasources were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all datasources were filtered out by the bounded context', () => {
      const result = constrainDatasources({
        datasources: mockDatasources.datasources,
        boundedContext: {
          projectIds: new Set(['123']),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          'While data sources were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    test.each(
      getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set([mockDatasources.datasources[0].project.id])],
        datasourceIds: [null, new Set([mockDatasources.datasources[0].id])],
        workbookIds: [null], // n/a for datasources
        viewIds: [null], // n/a for datasources
        tags: [null, new Set([mockDatasources.datasources[0].tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        const result = constrainDatasources({
          datasources: mockDatasources.datasources,
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        if (!projectIds && !datasourceIds && !tags) {
          expect(result.result).toEqual(mockDatasources.datasources);
        } else {
          expect(result.result).toEqual([mockDatasources.datasources[0]]);
        }
      },
    );
  });
});

async function getToolResult(
  params: { filter: string; pageNumber?: number; limit?: number },
  extra: TableauWebRequestHandlerExtra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const listDatasourcesTool = getListDatasourcesTool(new WebMcpServer());
  const callback = await Provider.from(listDatasourcesTool.callback);
  return await callback(
    { filter: params.filter, pageNumber: params.pageNumber, limit: params.limit },
    extra,
  );
}
