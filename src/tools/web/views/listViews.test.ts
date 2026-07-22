import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { WebMcpServer } from '../../../server.web.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { constrainViews, getListViewsTool } from './listViews.js';
import { mockView } from './mockView.js';

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
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        queryViewsForSite: mocks.mockQueryViewsForSiteData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listViewsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewsForSiteData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Overview' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
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
  filter: string;
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
