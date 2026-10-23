import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as loggerModule from '../../../logging/logger.js';
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

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

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

  it('should return a page-exceeds-limit error without fetching when the page is past the cap', async () => {
    const extra = getMockRequestHandlerExtra();
    const stubConfig = new OverridableConfig({});
    // Cap of 2700: page 3 (offset 2000) is reachable, page 4 (offset 3000) is not.
    vi.spyOn(stubConfig, 'getMaxResultLimit').mockReturnValue(2700);
    vi.mocked(extra.getConfigWithOverrides).mockResolvedValue(stubConfig);

    const result = await getToolResult({ filter: 'name:eq:Superstore', pageNumber: 4 }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('The requested page (4) exceeds the response limit');
    expect(result.content[0].text).toContain('the highest page you can request is 3');
    // The guard short-circuits before any REST call is made.
    expect(mocks.mockListDatasources).not.toHaveBeenCalled();
  });

  it('should still fetch the last reachable page under a cap that trims it', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      id: `id-${i}`,
      name: `Datasource ${i}`,
      project: { id: 'p1', name: 'Project' },
      tags: { tag: [] },
    }));
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 3, pageSize: 1000, totalAvailable: 2800 },
      datasources: page,
    });

    const extra = getMockRequestHandlerExtra();
    const stubConfig = new OverridableConfig({});
    vi.spyOn(stubConfig, 'getMaxResultLimit').mockReturnValue(2700);
    vi.mocked(extra.getConfigWithOverrides).mockResolvedValue(stubConfig);

    // Page 3 starts at offset 2000; cap 2700 leaves 700 reachable items and
    // caps the reported total (min(2800, 2700)).
    const result = await getToolResult({ filter: 'name:eq:Superstore', pageNumber: 3 }, extra);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBe(700);
    expect(parsed.totalAvailable).toBe(2700);
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

  describe('mcp.resultInfo (server cap hides data sources)', () => {
    function mockFullPage(rawTotal: number): void {
      mocks.mockListDatasources.mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: rawTotal },
        datasources: Array.from({ length: 1000 }, (_, i) => ({
          id: `id-${i}`,
          name: `Datasource ${i}`,
          project: { id: i % 2 === 0 ? 'p1' : 'p2', name: 'Project' },
          tags: { tag: [] },
        })),
      });
    }

    function extraWithCap(
      maxResultLimit: number | null,
      boundedContext?: Partial<OverridableConfig['boundedContext']>,
    ): TableauWebRequestHandlerExtra {
      const extra = getMockRequestHandlerExtra();
      const stubConfig = new OverridableConfig({});
      vi.spyOn(stubConfig, 'getMaxResultLimit').mockReturnValue(maxResultLimit);
      stubConfig.boundedContext = { ...stubConfig.boundedContext, ...boundedContext };
      vi.mocked(extra.getConfigWithOverrides).mockResolvedValue(stubConfig);
      return extra;
    }

    async function getParsed(
      params: { pageNumber?: number; limit?: number },
      extra: TableauWebRequestHandlerExtra,
    ): Promise<any> {
      const result = await getToolResult({ filter: 'name:eq:Superstore', ...params }, extra);
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      return JSON.parse(result.content[0].text);
    }

    it('reports admin-cap when the cap is below the raw total', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({}, extraWithCap(700));

      expect(parsed.data).toHaveLength(700);
      expect(parsed.totalAvailable).toBe(700);
      expect(Object.keys(parsed).sort()).toEqual(['data', 'mcp', 'totalAvailable']);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 700, truncated: true, truncationReason: 'admin-cap' },
      });
    });

    it('reports admin-cap on a limit: 1 count call under a binding cap', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ limit: 1 }, extraWithCap(700));

      expect(parsed.totalAvailable).toBe(700);
      expect(parsed.mcp.resultInfo).toEqual({
        returnedCount: 1,
        truncated: true,
        truncationReason: 'admin-cap',
      });
    });

    it('counts returnedCount after the bounded-context filter', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({}, extraWithCap(700, { projectIds: new Set(['p1']) }));

      expect(parsed.data).toHaveLength(350);
      expect(parsed.totalAvailable).toBe(700);
      expect(parsed.mcp.resultInfo.returnedCount).toBe(350);
    });

    it('omits mcp with no cap, a non-binding cap, or only a caller limit', async () => {
      mockFullPage(2600);

      const noCap = await getParsed({}, extraWithCap(null));
      const nonBindingCap = await getParsed({}, extraWithCap(2600));
      const limitOnly = await getParsed({ limit: 1 }, extraWithCap(null));

      expect(noCap).not.toHaveProperty('mcp');
      expect(Object.keys(noCap).sort()).toEqual(['data', 'totalAvailable']);
      expect(nonBindingCap).not.toHaveProperty('mcp');
      expect(Object.keys(nonBindingCap).sort()).toEqual(['data', 'totalAvailable']);
      expect(nonBindingCap.totalAvailable).toBe(2600);
      expect(limitOnly).not.toHaveProperty('mcp');
      expect(limitOnly.totalAvailable).toBe(2600);
    });
  });

  describe('INCLUDE_TAGS server-side filter', () => {
    function extraWithTags(tags: Set<string> | null): TableauWebRequestHandlerExtra {
      const extra = getMockRequestHandlerExtra();
      const stubConfig = new OverridableConfig({});
      stubConfig.boundedContext = { ...stubConfig.boundedContext, tags };
      vi.mocked(extra.getConfigWithOverrides).mockResolvedValue(stubConfig);
      return extra;
    }

    it('injects the allowed tag when the caller supplies no filter', async () => {
      mocks.mockListDatasources.mockResolvedValue(mockDatasources);
      await getToolResult({ filter: '' }, extraWithTags(new Set(['Finance'])));
      expect(mocks.mockListDatasources).toHaveBeenCalledWith(
        expect.objectContaining({ filter: 'tags:eq:Finance' }),
      );
    });

    it('appends the allowed tags onto the caller filter', async () => {
      mocks.mockListDatasources.mockResolvedValue(mockDatasources);
      await getToolResult(
        { filter: 'name:eq:Superstore' },
        extraWithTags(new Set(['Finance', 'HR'])),
      );
      expect(mocks.mockListDatasources).toHaveBeenCalledWith(
        expect.objectContaining({ filter: 'name:eq:Superstore,tags:in:[Finance,HR]' }),
      );
    });

    it('leaves a caller-supplied tags filter untouched', async () => {
      mocks.mockListDatasources.mockResolvedValue(mockDatasources);
      await getToolResult({ filter: 'tags:eq:Other' }, extraWithTags(new Set(['Finance'])));
      expect(mocks.mockListDatasources).toHaveBeenCalledWith(
        expect.objectContaining({ filter: 'tags:eq:Other' }),
      );
    });
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

    describe('datasource without a project', () => {
      const noProjectDatasource = {
        id: '3d4c7c20-c0b9-4880-a225-9bdc657b21f8',
        name: 'Deleted Datasource',
        tags: {},
      };
      const boundedContext = {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      };

      it('should exclude it when a project allowlist is set', () => {
        const result = constrainDatasources({
          datasources: [mockDatasources.datasources[0], noProjectDatasource],
          boundedContext: {
            ...boundedContext,
            projectIds: new Set([mockDatasources.datasources[0].project.id]),
          },
        });

        invariant(result.type === 'success');
        expect(result.result).toEqual([mockDatasources.datasources[0]]);
      });

      it('should keep it when no project allowlist is set', () => {
        const result = constrainDatasources({
          datasources: [mockDatasources.datasources[0], noProjectDatasource],
          boundedContext,
        });

        invariant(result.type === 'success');
        expect(result.result).toEqual([mockDatasources.datasources[0], noProjectDatasource]);
      });
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
