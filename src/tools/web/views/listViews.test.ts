import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
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
    const { usage: _usage, ...mockViewWithoutUsage } = mockView;
    expect(JSON.parse(`${result.content[0].text}`)).toMatchObject([
      { ...mockViewWithoutUsage, totalViewCount: 42 },
    ]);
    expect(mocks.mockQueryViewsForSiteData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Overview',
      includeUsageStatistics: true,
      pageNumber: undefined,
      pageSize: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewsForSiteData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Overview' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
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
      const views = JSON.parse(`${result.content[0].text}`);
      expect(views.map((v: { id: string }) => v.id).sort()).toEqual(
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
      const views = JSON.parse(`${result.content[0].text}`);
      expect(views).toHaveLength(1);
      expect(views[0].id).toBe(mockView.id);
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
      const views = JSON.parse(`${result.content[0].text}`);
      expect(views).toHaveLength(1);
      expect(views[0].id).toBe(mockView.id);
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
      const views = JSON.parse(`${result.content[0].text}`);
      expect(views).toHaveLength(1);
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

async function getToolResult(params: { filter?: string; limit?: number }): Promise<CallToolResult> {
  const listViewsTool = getListViewsTool(new WebMcpServer());
  const callback = await Provider.from(listViewsTool.callback);
  return await callback(
    { filter: params.filter, pageSize: undefined, limit: params.limit },
    getMockRequestHandlerExtra(),
  );
}
