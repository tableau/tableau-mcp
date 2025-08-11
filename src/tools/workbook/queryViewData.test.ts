import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getQueryViewDataTool } from './queryViewData.js';

const mockViewData =
  '"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Alberta,19.5%,53.41,-114.42\n"';

const mocks = vi.hoisted(() => ({
  mockQueryViewData: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbookMethods: {
        queryViewData: mocks.mockQueryViewData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('queryViewDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const queryViewDataTool = getQueryViewDataTool(new Server());
    expect(queryViewDataTool.name).toBe('query-view-data');
    expect(queryViewDataTool.description).toContain(
      'Returns a specified view rendered as data in comma separated value (CSV) format.',
    );
    expect(queryViewDataTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view data', async () => {
    mocks.mockQueryViewData.mockResolvedValue(mockViewData);
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain(
      'Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)',
    );
    expect(result.content[0].text).toContain('Canada,Alberta,19.5%,53.41,-114.42');
    expect(mocks.mockQueryViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { viewId: string }): Promise<CallToolResult> {
  const queryViewDataTool = getQueryViewDataTool(new Server());
  return await queryViewDataTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
