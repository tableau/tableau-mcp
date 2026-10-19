import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { constrainViews, getListViewsTool } from './listViews.js';
import { mockView, mockView2 } from './mockView.js';

const mockViews = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  views: [mockView],
};

const { usage: _mockViewUsage, ...mockViewWithoutUsage } = mockView;
const mockFlattenedView = { ...mockViewWithoutUsage, totalViewCount: 42 };

const mocks = vi.hoisted(() => ({
  mockQueryViewsForSiteData: vi.fn(),
  mockGetView: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        queryViewsForSite: mocks.mockQueryViewsForSiteData,
        getView: mocks.mockGetView,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listViewsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const listViewsTool = getListViewsTool(new WebMcpServer());
    expect(listViewsTool.name).toBe('list-views');
    expect(listViewsTool.description).toContain(
      'Retrieves a list of views on a Tableau site including their metadata such as name, owner, and the workbook they are found in.',
    );
    expect(listViewsTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully get views', async () => {
    mocks.mockQueryViewsForSiteData.mockResolvedValue(mockViews);
    const result = await getToolResult({ filter: 'name:eq:Overview' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.data).toMatchObject([mockFlattenedView]);
    expect(parsed.totalAvailable).toBe(mockViews.pagination.totalAvailable);
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Overview',
      includeUsageStatistics: true,
      pageNumber: 1,
      pageSize: 1000,
    });
  });

  it('fetches only a single page and does not loop', async () => {
    const manyViews = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => ({
      ...mockView,
      id: `view-${i}`,
    }));
    mocks.mockQueryViewsForSiteData.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: MAX_PAGE_SIZE, totalAvailable: 2600 },
      views: manyViews,
    });

    const result = await getToolResult({ filter: 'name:eq:Overview' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.data.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(parsed.data.length).toBe(MAX_PAGE_SIZE);
    expect(parsed.totalAvailable).toBe(2600);
    // Single-page semantics: the REST method is called exactly once (no looping).
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledTimes(1);
  });

  it('passes pageNumber through to the REST method', async () => {
    mocks.mockQueryViewsForSiteData.mockResolvedValue({
      pagination: { pageNumber: 3, pageSize: MAX_PAGE_SIZE, totalAvailable: 2600 },
      views: [mockView],
    });

    await getToolResult({ filter: 'name:eq:Overview', pageNumber: 3 });

    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Overview',
      includeUsageStatistics: true,
      pageNumber: 3,
      pageSize: 1000,
    });
  });

  it('trims the page to the caller limit without capping totalAvailable', async () => {
    const manyViews = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => ({
      ...mockView,
      id: `view-${i}`,
    }));
    mocks.mockQueryViewsForSiteData.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: MAX_PAGE_SIZE, totalAvailable: 2600 },
      views: manyViews,
    });

    const result = await getToolResult({ filter: 'name:eq:Overview', limit: 600 });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.data.length).toBe(600);
    expect(parsed.totalAvailable).toBe(2600);
    // Still always requests a full page from the API regardless of caller limit.
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 1000, pageNumber: 1 }),
    );
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledTimes(1);
  });

  it('caps totalAvailable and trims the page when the server maxResultLimit is smaller than the page', async () => {
    const manyViews = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => ({
      ...mockView,
      id: `view-${i}`,
    }));
    mocks.mockQueryViewsForSiteData.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: MAX_PAGE_SIZE, totalAvailable: 2600 },
      views: manyViews,
    });

    const result = await getToolResult({
      filter: 'name:eq:Overview',
      maxResultLimit: 700,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.data.length).toBe(700);
    expect(parsed.totalAvailable).toBe(700);
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledTimes(1);
  });

  it('returns a page-exceeds-limit error without fetching when the page is past the cap', async () => {
    // Cap of 2700: page 3 (offset 2000) is reachable, page 4 (offset 3000) is not.
    const result = await getToolResult({
      filter: 'name:eq:Overview',
      pageNumber: 4,
      maxResultLimit: 2700,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('The requested page (4) exceeds the response limit');
    expect(result.content[0].text).toContain('the highest page you can request is 3');
    expect(mocks.mockQueryViewsForSiteData).not.toHaveBeenCalled();
  });

  it('still fetches the last reachable page under a cap that trims it', async () => {
    const manyViews = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => ({
      ...mockView,
      id: `view-${i}`,
    }));
    mocks.mockQueryViewsForSiteData.mockResolvedValue({
      pagination: { pageNumber: 3, pageSize: MAX_PAGE_SIZE, totalAvailable: 2800 },
      views: manyViews,
    });

    // Page 3 starts at offset 2000; cap 2700 leaves 700 reachable items and
    // caps the reported total (min(2800, 2700)).
    const result = await getToolResult({
      filter: 'name:eq:Overview',
      pageNumber: 3,
      maxResultLimit: 2700,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.data.length).toBe(700);
    expect(parsed.totalAvailable).toBe(2700);
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewsForSiteData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Overview' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('mcp.resultInfo (server cap hides views)', () => {
    function mockFullPage(rawTotal: number): void {
      mocks.mockQueryViewsForSiteData.mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: MAX_PAGE_SIZE, totalAvailable: rawTotal },
        views: Array.from({ length: MAX_PAGE_SIZE }, (_, i) => ({
          ...mockView,
          id: `view-${i}`,
          project: { id: i % 2 === 0 ? 'p1' : 'p2' },
        })),
      });
    }

    async function getParsed(params: {
      limit?: number;
      maxResultLimit: number | null;
      projectIds?: Set<string>;
    }): Promise<any> {
      const extra = getMockRequestHandlerExtra();
      const config = new OverridableConfig({});
      vi.spyOn(config, 'getMaxResultLimit').mockReturnValue(params.maxResultLimit);
      if (params.projectIds) {
        config.boundedContext = { ...config.boundedContext, projectIds: params.projectIds };
      }
      extra.getConfigWithOverrides = vi.fn().mockResolvedValue(config);

      const callback = await Provider.from(getListViewsTool(new WebMcpServer()).callback);
      const result = await callback(
        { filter: 'name:eq:Overview', pageNumber: undefined, limit: params.limit },
        extra,
      );
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      return JSON.parse(result.content[0].text);
    }

    it('reports admin-cap when the cap is below the raw total', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ maxResultLimit: 700 });

      expect(parsed.data).toHaveLength(700);
      expect(parsed.totalAvailable).toBe(700);
      expect(Object.keys(parsed).sort()).toEqual(['data', 'mcp', 'totalAvailable']);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 700, truncated: true, truncationReason: 'admin-cap' },
      });
    });

    it('reports admin-cap on a limit: 1 count call under a binding cap', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ limit: 1, maxResultLimit: 700 });

      expect(parsed.totalAvailable).toBe(700);
      expect(parsed.mcp.resultInfo.returnedCount).toBe(1);
      expect(parsed.mcp.resultInfo.truncationReason).toBe('admin-cap');
    });

    it('counts returnedCount after the bounded-context filter', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ maxResultLimit: 700, projectIds: new Set(['p1']) });

      expect(parsed.data).toHaveLength(350);
      expect(parsed.totalAvailable).toBe(700);
      expect(parsed.mcp.resultInfo.returnedCount).toBe(350);
    });

    it('omits mcp with no cap, a non-binding cap, or only a caller limit', async () => {
      mockFullPage(2600);

      const noCap = await getParsed({ maxResultLimit: null });
      const nonBindingCap = await getParsed({ maxResultLimit: 2600 });
      const limitOnly = await getParsed({ limit: 1, maxResultLimit: null });

      expect(noCap).not.toHaveProperty('mcp');
      expect(Object.keys(noCap).sort()).toEqual(['data', 'totalAvailable']);
      expect(nonBindingCap).not.toHaveProperty('mcp');
      expect(Object.keys(nonBindingCap).sort()).toEqual(['data', 'totalAvailable']);
      expect(nonBindingCap.totalAvailable).toBe(2600);
      expect(limitOnly).not.toHaveProperty('mcp');
      expect(limitOnly.totalAvailable).toBe(2600);
    });
  });

  describe('INCLUDE_VIEW_IDS fast path (fetch by ID)', () => {
    function makeAxiosError(status: number): Error {
      return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status },
      });
    }

    it('should fetch views by ID when INCLUDE_VIEW_IDS is set and no filter is provided', async () => {
      vi.stubEnv('INCLUDE_VIEW_IDS', `${mockView.id},${mockView2.id}`);
      mocks.mockGetView.mockImplementation(async ({ viewId }: { viewId: string }) =>
        viewId === mockView.id ? mockView : mockView2,
      );

      const result = await getToolResult({});

      expect(result.isError).toBe(false);
      expect(mocks.mockGetView).toHaveBeenCalledTimes(2);
      expect(mocks.mockGetView).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        viewId: mockView.id,
        includeUsageStatistics: true,
      });
      expect(mocks.mockQueryViewsForSiteData).not.toHaveBeenCalled();

      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(`${result.content[0].text}`);
      expect(parsed.data.map((v: { id: string }) => v.id).sort()).toEqual(
        [mockView.id, mockView2.id].sort(),
      );
    });

    it('should silently omit views that return 403 or 404', async () => {
      vi.stubEnv('INCLUDE_VIEW_IDS', `${mockView.id},not-allowed,missing`);
      mocks.mockGetView.mockImplementation(async ({ viewId }: { viewId: string }) => {
        if (viewId === 'not-allowed') {
          throw makeAxiosError(403);
        }
        if (viewId === 'missing') {
          throw makeAxiosError(404);
        }
        return mockView;
      });

      const result = await getToolResult({});

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(`${result.content[0].text}`);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].id).toBe(mockView.id);
    });

    it('should propagate non-403/404 errors', async () => {
      vi.stubEnv('INCLUDE_VIEW_IDS', `${mockView.id},boom`);
      mocks.mockGetView.mockImplementation(async ({ viewId }: { viewId: string }) => {
        if (viewId === 'boom') {
          throw makeAxiosError(500);
        }
        return mockView;
      });

      const result = await getToolResult({});

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('500');
    });

    it('should use the slow path when a filter is provided alongside INCLUDE_VIEW_IDS', async () => {
      vi.stubEnv('INCLUDE_VIEW_IDS', mockView.id);
      mocks.mockQueryViewsForSiteData.mockResolvedValue(mockViews);

      const result = await getToolResult({ filter: 'name:eq:Overview' });

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledTimes(1);
      expect(mocks.mockGetView).not.toHaveBeenCalled();
    });

    it('should still apply coexisting bounds (e.g. project) to fetched views', async () => {
      vi.stubEnv('INCLUDE_VIEW_IDS', `${mockView.id},${mockView2.id}`);
      // Only mockView's project is allowed; mockView2 must be filtered out by constrainViews.
      vi.stubEnv('INCLUDE_PROJECT_IDS', mockView.project.id);
      mocks.mockGetView.mockImplementation(async ({ viewId }: { viewId: string }) =>
        viewId === mockView.id ? mockView : mockView2,
      );

      const result = await getToolResult({});

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(`${result.content[0].text}`);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].id).toBe(mockView.id);
    });

    it('should slice fetched views to the effective limit', async () => {
      vi.stubEnv('INCLUDE_VIEW_IDS', `${mockView.id},${mockView2.id}`);
      mocks.mockGetView.mockImplementation(async ({ viewId }: { viewId: string }) =>
        viewId === mockView.id ? mockView : mockView2,
      );

      const result = await getToolResult({ limit: 1 });

      expect(result.isError).toBe(false);
      // All allowed views are fetched before slicing, then trimmed to the limit.
      expect(mocks.mockGetView).toHaveBeenCalledTimes(2);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(`${result.content[0].text}`);
      expect(parsed.data).toHaveLength(1);
    });
  });

  describe('constrainViews', () => {
    it('should return empty result when no views are found', () => {
      const result = constrainViews({
        views: [],
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
        'No views were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all views were filtered out by the bounded context', () => {
      const result = constrainViews({
        views: mockViews.views,
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
          'The set of allowed views that can be queried is limited by the server configuration.',
          'While views were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    it('should return empty results when all views are filtered out by viewIds', () => {
      const result = constrainViews({
        views: mockViews.views,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set(['some-other-view-id']),
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed views that can be queried is limited by the server configuration.',
          'While views were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    test.each(
      getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set([mockViews.views[0].project.id])],
        datasourceIds: [null], // n/a for views
        workbookIds: [null, new Set([mockViews.views[0].workbook.id])],
        viewIds: [null, new Set([mockViews.views[0].id])],
        tags: [null, new Set([mockViews.views[0].tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        const result = constrainViews({
          views: mockViews.views,
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        if (!projectIds && !workbookIds && !viewIds && !tags) {
          expect(result.result).toEqual(mockViews.views);
        } else {
          expect(result.result).toEqual([mockViews.views[0]]);
        }
      },
    );
  });
});

async function getToolResult(params: {
  filter?: string;
  pageNumber?: number;
  limit?: number;
  maxResultLimit?: number | null;
}): Promise<CallToolResult> {
  const listViewsTool = getListViewsTool(new WebMcpServer());
  const callback = await Provider.from(listViewsTool.callback);

  const extra = getMockRequestHandlerExtra();
  if (params.maxResultLimit !== undefined) {
    const config = new OverridableConfig({});
    vi.spyOn(config, 'getMaxResultLimit').mockReturnValue(params.maxResultLimit);
    extra.getConfigWithOverrides = vi.fn().mockResolvedValue(config);
  }

  return await callback(
    {
      filter: params.filter,
      pageNumber: params.pageNumber,
      limit: params.limit,
    },
    extra,
  );
}
