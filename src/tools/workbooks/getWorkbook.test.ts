import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { mockView } from '../views/mockView.js';
import { filterWorkbookViews, getGetWorkbookTool } from './getWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockQueryViewsForWorkbook: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
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
    vi.stubEnv('SERVER', 'https://test-server.example.com');
    vi.stubEnv('SITE_NAME', 'test-site');
    vi.stubEnv('PAT_NAME', 'test-pat-name');
    vi.stubEnv('PAT_VALUE', 'test-pat-value');
    resetResourceAccessCheckerSingleton();
  });

  it('should create a tool instance with correct properties', () => {
    const getWorkbookTool = getGetWorkbookTool(new Server());
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
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockGetWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
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
    it('should return the workbook when no filtering occurs', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          tags: null,
        },
      });
      invariant(result.type === 'success');
      expect(result.result).toEqual(mockWorkbook);
    });

    it('should return the views that match the tags in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          tags: new Set(['tag-1']),
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual(mockWorkbook);
    });

    it('should remove views from the workbook when all views were filtered out by the tags in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          tags: new Set(['some-other-tag']),
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual({ ...mockWorkbook, views: { view: [] } });
    });
  });
});

async function getToolResult(params: { workbookId: string }): Promise<CallToolResult> {
  const getWorkbookTool = getGetWorkbookTool(new Server());
  const callback = await Provider.from(getWorkbookTool.callback);
  return await callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
