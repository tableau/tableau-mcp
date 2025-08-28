import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getListViewsTool } from './listViews.js';

const mockViews = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  views: [
    {
      id: 'be75437c-fa5c-4218-914c-8c3efcf6a59c',
      name: 'Overview',
      createdAt: '2024-06-10T23:23:23Z',
      updatedAt: '2024-06-10T23:23:23Z',
      tags: {
        tag: [
          {
            label: 'tag-1',
          },
        ],
      },
    },
  ],
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
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listViewsTool = getListViewsTool(new Server());
  return await listViewsTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
