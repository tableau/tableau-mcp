import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockView } from '../views/mockView.js';
import { exportedForTesting, filterWorkbookViews, getGetWorkbookTool } from './getWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

const { getDefaultViewWebUrl } = exportedForTesting;

const { usage: _usage, ...mockViewWithoutUsage } = mockView;
const mockWorkbookWithFlattenedViewUsage = {
  ...mockWorkbook,
  views: {
    view: [{ ...mockViewWithoutUsage, totalViewCount: 42 }],
  },
};

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockQueryViewsForWorkbook: vi.fn(),
  mockQueryWorkbookConnections: vi.fn(),
  mockGraphql: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        queryWorkbookConnections: mocks.mockQueryWorkbookConnections,
      },
      viewsMethods: {
        queryViewsForWorkbook: mocks.mockQueryViewsForWorkbook,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

const emptyWorkbookLineage = { data: { workbooksConnection: { nodes: [] } } };

describe('getWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    // Safe defaults: no connections, empty published lineage.
    mocks.mockQueryWorkbookConnections.mockResolvedValue([]);
    mocks.mockGraphql.mockResolvedValue(emptyWorkbookLineage);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const getWorkbookTool = getGetWorkbookTool(new WebMcpServer());
    expect(getWorkbookTool.name).toBe('get-workbook');
    expect(getWorkbookTool.description).toContain(
      'Retrieves information about the specified workbook',
    );
    expect(getWorkbookTool.paramsSchema).toMatchObject({ workbookId: expect.any(Object) });
  });

  it('should successfully get workbook', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    mocks.mockQueryViewsForWorkbook.mockResolvedValue([mockView]);
    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const response = JSON.parse(result.content[0].text);
    expect(response.data).toBeDefined();
    expect(response.url).toBeDefined();
    expect(response.data.id).toBe('96a43833-27db-40b6-aa80-751efc776b9a');
    expect(response.data.name).toBe('Superstore');
    expect(response.data.views.view).toHaveLength(1);
    expect(response.data.views.view[0].totalViewCount).toBe(42);
    expect(response.data.views.view[0].usage).toBeUndefined(); // should be flattened
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );

    expect(mocks.mockGetWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });
    expect(mocks.mockQueryViewsForWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeUsageStatistics: true,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGetWorkbook.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return workbook not allowed error when workbook is not allowed', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({ workbookId: mockWorkbook.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        'Querying the workbook with LUID 96a43833-27db-40b6-aa80-751efc776b9a is not allowed.',
      ].join(' '),
    );

    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockQueryViewsForWorkbook).not.toHaveBeenCalled();
  });

  describe('upstream datasource enrichment', () => {
    const workbookId = '96a43833-27db-40b6-aa80-751efc776b9a';

    beforeEach(() => {
      mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
      mocks.mockQueryViewsForWorkbook.mockResolvedValue([mockView]);
    });

    it('enriches with embedded datasources from a single /connections call', async () => {
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledTimes(1);
      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledWith({
        workbookId,
        siteId: 'test-site-id',
      });
      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('combines published (metadata) and embedded entries, tagging each type', async () => {
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'pub-luid-1', name: 'Published DS', datasourceType: 'published' },
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('attaches a publishedParent pointer from authoritative metadata linkage', async () => {
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                embeddedDatasources: [
                  {
                    name: 'Embedded DS',
                    parentPublishedDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                  },
                ],
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'pub-luid-1', name: 'Published DS', datasourceType: 'published' },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          publishedParent: { luid: 'pub-luid-1', name: 'Published DS' },
        },
      ]);
    });

    it('does not attach a publishedParent when the Metadata API is disabled', async () => {
      vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'true');
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'emb-luid-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('falls back to the luid when a connection datasource has no name', async () => {
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'emb-luid-1', datasourceType: 'embedded' },
      ]);
    });

    it('surfaces embedded datasources without calling the Metadata API when it is disabled', async () => {
      vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'true');
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(mocks.mockGraphql).not.toHaveBeenCalled();
      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledTimes(1);
      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('swallows a failed /connections call and still returns the workbook', async () => {
      mocks.mockQueryWorkbookConnections.mockRejectedValue(new Error('connections boom'));

      const response = await getResponseData({ workbookId });

      expect(response.data.id).toBe(workbookId);
      expect(response.data.upstreamDatasources).toBeUndefined();
    });
  });

  describe('getDefaultViewWebUrl', () => {
    const server = 'https://my-tableau-server.com';
    const siteName = 'tc25';

    it('should return URL for default view when it exists', () => {
      const workbook = {
        ...mockWorkbook,
        defaultViewId: mockView.id,
        views: { view: [mockView] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBe('https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview');
    });

    it('should fall back to first view when default view is not found', () => {
      const mockView2 = {
        ...mockView,
        id: 'other-view-id',
        contentUrl: 'Superstore/OtherView',
      };

      const workbook = {
        ...mockWorkbook,
        defaultViewId: 'non-existent-view-id', // Default view not in the list
        views: { view: [mockView2] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBe('https://my-tableau-server.com/#/site/tc25/views/Superstore/OtherView');
    });

    it('should use first view when workbook has no defaultViewId', () => {
      const workbook = {
        ...mockWorkbook,
        defaultViewId: undefined,
        views: { view: [mockView] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBe('https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview');
    });

    it('should return undefined when workbook has no views', () => {
      const workbook = {
        ...mockWorkbook,
        views: { view: [] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBeUndefined();
    });

    it('should return undefined when workbook views is undefined', () => {
      const workbook = {
        ...mockWorkbook,
        views: undefined,
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBeUndefined();
    });
  });

  describe('filterWorkbookViews', () => {
    it('should return the workbook when no filtering occurs', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });
      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should return the views that match the tags in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: new Set(['tag-1']),
        },
      });

      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should remove views from the workbook when all views were filtered out by the tags in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: new Set(['some-other-tag']),
        },
      });

      expect(result).toEqual({
        ...mockWorkbook,
        views: { view: [] },
      });
    });

    it('should return the views that match viewIds in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: null,
        },
      });

      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should remove views from the workbook when all views are filtered out by viewIds', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set(['some-other-view-id']),
          tags: null,
        },
      });

      expect(result).toEqual({
        ...mockWorkbook,
        views: { view: [] },
      });
    });

    it('should apply both viewIds and tags filters in conjunction (AND)', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: new Set(['tag-1']),
        },
      });

      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should remove views when viewIds matches but tags do not', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: new Set(['some-other-tag']),
        },
      });

      expect(result).toEqual({
        ...mockWorkbook,
        views: { view: [] },
      });
    });
  });
});

async function getToolResult(params: { workbookId: string }): Promise<CallToolResult> {
  const getWorkbookTool = getGetWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(getWorkbookTool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}

async function getResponseData(params: { workbookId: string }): Promise<any> {
  const result = await getToolResult(params);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
