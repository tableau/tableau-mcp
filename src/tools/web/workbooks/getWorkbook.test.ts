import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockView } from '../views/mockView.js';
import { filterWorkbookViews, getGetWorkbookTool } from './getWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

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
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      viewsMethods: {
        queryViewsForWorkbook: mocks.mockQueryViewsForWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
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

  describe('filterWorkbookViews', () => {
    const createTestWorkbook = (): Workbook => {
      return JSON.parse(JSON.stringify(mockWorkbook));
    };

    it('should return the workbook when no filtering occurs', () => {
      const result = filterWorkbookViews({
        workbook: createTestWorkbook(),
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
        workbook: createTestWorkbook(),
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
        workbook: createTestWorkbook(),
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
        workbook: createTestWorkbook(),
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: null,
        },
      });

      expect(result.views?.view.length).toBe(1);
      expect(result.views?.view[0].id).toBe(mockView.id);
      expect(result.views?.view[0].totalViewCount).toBe(42);
    });

    it('should remove views from the workbook when all views are filtered out by viewIds', () => {
      const result = filterWorkbookViews({
        workbook: createTestWorkbook(),
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
        workbook: createTestWorkbook(),
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: new Set(['tag-1']),
        },
      });

      expect(result.views?.view.length).toBe(1);
      expect(result.views?.view[0].id).toBe(mockView.id);
      expect(result.views?.view[0].totalViewCount).toBe(42);
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
