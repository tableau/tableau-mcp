import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getListWorkbooksTool } from './listWorkbooks.js';
import { mockWorkbook } from './mockWorkbook.js';

const mockWorkbooks = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  workbooks: [mockWorkbook],
};

const mocks = vi.hoisted(() => ({
  mockQueryWorkbooksForSite: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        queryWorkbooksForSite: mocks.mockQueryWorkbooksForSite,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listWorkbooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listWorkbooksTool = getListWorkbooksTool(new Server());
    expect(listWorkbooksTool.name).toBe('list-workbooks');
    expect(listWorkbooksTool.description).toContain(
      'Retrieves a list of workbooks on a Tableau site',
    );
    expect(listWorkbooksTool.paramsSchema).toMatchObject({});
  });

  it('should successfully query workbooks', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue(mockWorkbooks);
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryWorkbooksForSite.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listWorkbooksTool = getListWorkbooksTool(new Server());
  return await listWorkbooksTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
