import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getMockRequestHandlerExtra } from '../../testShared.js';
import { getCombinationsOfBoundedContextInputs } from '../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
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

const mocks = vi.hoisted(() => ({
  mockQueryViewsForSiteData: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
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
    const listViewsTool = getListViewsTool(new Server());
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
    expect(JSON.parse(`${result.content[0].text}`)).toMatchObject(mockViews.views);
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

  describe('constrainViews', () => {
    it('should return empty result when no views are found', () => {
      const result = constrainViews({
        views: [],
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null, tags: null },
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
        tags: [null, new Set([mockViews.views[0].tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, tags }) => {
        const result = constrainViews({
          views: mockViews.views,
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        if (!projectIds && !workbookIds && !tags) {
          expect(result.result).toEqual(mockViews.views);
        } else {
          expect(result.result).toEqual([mockViews.views[0]]);
        }
      },
    );
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listViewsTool = getListViewsTool(new Server());
  const callback = await Provider.from(listViewsTool.callback);
  return await callback(
    { filter: params.filter, pageSize: undefined, limit: undefined },
    getMockRequestHandlerExtra(),
  );
}
