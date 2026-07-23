import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from '../workbooks/mockWorkbook.js';
import { constrainCustomViews, getListCustomViewsTool } from './listCustomViews.js';
import { mockCustomView } from './mockCustomView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockCustomViews = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  customViews: [mockCustomView],
};

function makeCustomViewPage(count: number): Array<typeof mockCustomView> {
  return Array.from({ length: count }, (_, i) => ({
    ...mockCustomView,
    id: `custom-view-${i}`,
  }));
}

const mocks = vi.hoisted(() => ({
  mockListCustomViews: vi.fn(),
  mockGetWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      viewsMethods: {
        listCustomViews: mocks.mockListCustomViews,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listCustomViewsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const listCustomViewsTool = getListCustomViewsTool(new WebMcpServer());
    expect(listCustomViewsTool.name).toBe('list-custom-views');
    expect(listCustomViewsTool.description).toContain(
      'Retrieves a list of custom views for a Tableau workbook including their metadata such as name, owner, and the view they are found in.',
    );
    expect(listCustomViewsTool.paramsSchema).toMatchObject({
      workbookId: expect.any(Object),
      filter: expect.any(Object),
      limit: expect.any(Object),
    });
  });

  it('should successfully get custom views', async () => {
    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed).toMatchObject(mockCustomViews.customViews);
    expect(mocks.mockListCustomViews).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `workbookId:eq:${mockWorkbook.id},viewId:eq:${mockCustomView.view.id}`,
      pageNumber: 1,
      pageSize: 1000,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListCustomViews.mockRejectedValue(new Error(errorMessage));
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return a workbook not found error if the workbook is not found', async () => {
    mocks.mockGetWorkbook.mockRejectedValue(
      new Error(`The workbook with LUID ${mockWorkbook.id} was not found.`),
    );
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      `The workbook with LUID ${mockWorkbook.id} was not found.`,
    );
  });

  it('should ignore the workbookId filter if it is provided', async () => {
    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `workbookId:eq:some-other-workbook-id,viewId:eq:${mockCustomView.view.id}`,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(`${result.content[0].text}`)).toMatchObject(mockCustomViews.customViews);
    expect(mocks.mockListCustomViews).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `workbookId:eq:${mockWorkbook.id},viewId:eq:${mockCustomView.view.id}`,
      pageNumber: 1,
      pageSize: 1000,
    });
  });

  it('should return a custom view not allowed error if its workbook is not allowed due to tool scoping', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');

    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      [
        `The custom views from the workbook with LUID ${mockWorkbook.id} are not allowed to be queried.`,
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        `Querying the workbook with LUID ${mockWorkbook.id} is not allowed.`,
      ].join(' '),
    );
  });

  it('should include custom views whose underlying view is in INCLUDE_VIEW_IDS', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', mockCustomView.view.id);
    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(`${result.content[0].text}`)).toMatchObject(mockCustomViews.customViews);
  });

  it('should filter out custom views whose underlying view is not in INCLUDE_VIEW_IDS', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', 'some-other-view-id');
    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'The set of allowed views that can be queried is limited by the server configuration.',
        'While custom views were found, they were all filtered out by the server configuration.',
      ].join(' '),
    );
  });

  it('should fetch exactly one page and not loop when more results are available', async () => {
    const fullPage = makeCustomViewPage(MAX_PAGE_SIZE);
    mocks.mockListCustomViews.mockResolvedValue({
      pagination: {
        pageNumber: 1,
        pageSize: MAX_PAGE_SIZE,
        totalAvailable: 2600,
      },
      customViews: fullPage,
    });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.length).toBe(MAX_PAGE_SIZE);
    expect(parsed.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    // Single-page semantics: the REST method must be called exactly once (no looping).
    expect(mocks.mockListCustomViews).toHaveBeenCalledTimes(1);
    expect(mocks.mockListCustomViews).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `workbookId:eq:${mockWorkbook.id},viewId:eq:${mockCustomView.view.id}`,
      pageNumber: 1,
      pageSize: MAX_PAGE_SIZE,
    });
  });

  it('should always request the first page from the API', async () => {
    mocks.mockListCustomViews.mockResolvedValue(mockCustomViews);
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });

    expect(mocks.mockListCustomViews).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `workbookId:eq:${mockWorkbook.id},viewId:eq:${mockCustomView.view.id}`,
      pageNumber: 1,
      pageSize: MAX_PAGE_SIZE,
    });
  });

  it('should trim the results to the caller limit', async () => {
    const fullPage = makeCustomViewPage(MAX_PAGE_SIZE);
    mocks.mockListCustomViews.mockResolvedValue({
      pagination: {
        pageNumber: 1,
        pageSize: MAX_PAGE_SIZE,
        totalAvailable: 2600,
      },
      customViews: fullPage,
    });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
      limit: 600,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed.length).toBe(600);
    expect(mocks.mockListCustomViews).toHaveBeenCalledTimes(1);
    expect(mocks.mockListCustomViews).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `workbookId:eq:${mockWorkbook.id},viewId:eq:${mockCustomView.view.id}`,
      pageNumber: 1,
      pageSize: MAX_PAGE_SIZE,
    });
  });

  it('should trim the results when a server maxResultLimit is smaller than the page', async () => {
    vi.stubEnv('MAX_RESULT_LIMIT', '700');
    const fullPage = makeCustomViewPage(MAX_PAGE_SIZE);
    mocks.mockListCustomViews.mockResolvedValue({
      pagination: {
        pageNumber: 1,
        pageSize: MAX_PAGE_SIZE,
        totalAvailable: 2600,
      },
      customViews: fullPage,
    });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({
      workbookId: mockWorkbook.id,
      filter: `viewId:eq:${mockCustomView.view.id}`,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    // Server cap (700) trims this page below the 1000 the API returned.
    expect(parsed.length).toBe(700);
    expect(mocks.mockListCustomViews).toHaveBeenCalledTimes(1);
  });

  describe('constrainCustomViews', () => {
    it('should return empty result when no custom views are found', () => {
      const result = constrainCustomViews({
        customViews: [],
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
        'No custom views for this workbook were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return all custom views when viewIds is null', () => {
      const result = constrainCustomViews({
        customViews: [mockCustomView],
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockCustomView]);
    });

    it('should keep custom views whose underlying view id is in viewIds', () => {
      const result = constrainCustomViews({
        customViews: [mockCustomView],
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockCustomView.view.id]),
          tags: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockCustomView]);
    });

    it('should return empty when all custom views are filtered out by viewIds', () => {
      const result = constrainCustomViews({
        customViews: [mockCustomView],
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
          'While custom views were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });
  });
});

async function getToolResult(params: {
  workbookId: string;
  filter: string;
  limit?: number;
}): Promise<CallToolResult> {
  const listCustomViewsTool = getListCustomViewsTool(new WebMcpServer());
  const callback = await Provider.from(listCustomViewsTool.callback);
  return await callback(
    {
      workbookId: params.workbookId,
      filter: params.filter,
      limit: params.limit,
    },
    getMockRequestHandlerExtra(),
  );
}
