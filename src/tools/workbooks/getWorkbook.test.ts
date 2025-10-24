import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { mockView } from '../views/mockView.js';
import { getGetWorkbookTool } from './getWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockQueryViewsForWorkbook: vi.fn(),
  mockGetConfig: vi.fn(),
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

vi.mock('../../config.js', () => ({
  getConfig: mocks.mockGetConfig,
}));

describe('getWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetResourceAccessCheckerSingleton();
    mocks.mockGetConfig.mockReturnValue({
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
      },
    });
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
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return workbook not allowed error when workbook is not allowed', async () => {
    mocks.mockGetConfig.mockReturnValue({
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: new Set(['some-other-workbook-id']),
      },
    });
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({ workbookId: mockWorkbook.id });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      [
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        'Querying the workbook with LUID 96a43833-27db-40b6-aa80-751efc776b9a is not allowed.',
      ].join(' '),
    );

    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockQueryViewsForWorkbook).not.toHaveBeenCalled();
  });
});

async function getToolResult(params: { workbookId: string }): Promise<CallToolResult> {
  const getWorkbookTool = getGetWorkbookTool(new Server());
  return await getWorkbookTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
