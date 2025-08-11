import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getQueryWorkbooksTool } from './queryWorkbooks.js';

const mockWorkbooks = [mockWorkbook];

const mocks = vi.hoisted(() => ({
  mockQueryWorkbooksForSite: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbookMethods: {
        queryWorkbooksForSite: mocks.mockQueryWorkbooksForSite,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('queryWorkbooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const queryWorkbooksTool = getQueryWorkbooksTool(new Server());
    expect(queryWorkbooksTool.name).toBe('query-workbooks');
    expect(queryWorkbooksTool.description).toContain(
      'Retrieves information about the workbooks and views that are available on a Tableau site.',
    );
    expect(queryWorkbooksTool.paramsSchema).toMatchObject({});
  });

  it('should successfully query workbooks', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue(mockWorkbooks);
    const result = await getToolResult();
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledWith('test-site-id');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryWorkbooksForSite.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(): Promise<CallToolResult> {
  const queryWorkbooksTool = getQueryWorkbooksTool(new Server());
  return await queryWorkbooksTool.callback(
    {},
    {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    },
  );
}
