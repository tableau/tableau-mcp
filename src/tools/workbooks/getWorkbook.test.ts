import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getGetWorkbookTool } from './getWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbookMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
