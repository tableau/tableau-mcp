import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getSearchContentTool } from './searchContent.js';

export const mockSearchContentResponse = {
  next: 'next-page-url',
  prev: 'prev-page-url',
  pageIndex: 0,
  startIndex: 0,
  total: 3,
  limit: 100,
  items: [
    {
      uri: 'test-uri-1',
      content: {
        type: 'workbook',
        luid: 'workbook-1-luid',
        title: 'Sales Dashboard',
        ownerName: 'John Doe',
        ownerId: 123,
        ownerEmail: 'john.doe@example.com',
        projectId: 123456,
        projectName: 'Finance',
        containerName: 'Finance',
        hitsTotal: 150,
        hitsSmallSpanTotal: 10,
        hitsMediumSpanTotal: 25,
        hitsLargeSpanTotal: 50,
        favoritesTotal: 5,
        modifiedTime: '2024-01-15T10:30:00Z',
        createdTime: '2023-12-01T09:00:00Z',
        tags: ['dashboard', 'sales'],
      },
    },
    {
      uri: 'test-uri-2',
      content: {
        type: 'datasource',
        datasourceLuid: 'datasource-1-luid',
        title: 'Customer Data',
        ownerName: 'Jane Smith',
        ownerId: 456,
        ownerEmail: 'jane.smith@example.com',
        projectId: 987654,
        projectName: 'Marketing',
        containerName: 'Marketing',
        hitsTotal: 75,
        hitsSmallSpanTotal: 5,
        hitsMediumSpanTotal: 15,
        hitsLargeSpanTotal: 30,
        favoritesTotal: 3,
        modifiedTime: '2024-01-10T14:20:00Z',
        createdTime: '2023-11-15T11:30:00Z',
      },
    },
  ],
};

const mocks = vi.hoisted(() => ({
  mockSearchContent: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      contentExplorationMethods: {
        searchContent: mocks.mockSearchContent,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('searchContentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const searchContentTool = getSearchContentTool(new Server());
    expect(searchContentTool.name).toBe('search-content');
    expect(searchContentTool.description).toContain('searches across all supported content types');
    expect(searchContentTool.paramsSchema).toMatchObject({
      terms: expect.any(Object),
      limit: expect.any(Object),
      orderBy: expect.any(Object),
      filter: expect.any(Object),
    });
  });

  it('should successfully search content with basic parameters', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({ terms: 'sales dashboard' });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: 'sales dashboard',
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: undefined,
    });

    const responseData = JSON.parse(result.content[0].text as string);
    expect(responseData).toHaveLength(2);
    expect(responseData[0]).toMatchObject({
      type: 'workbook',
      title: 'Sales Dashboard',
      ownerName: 'John Doe',
      totalViewCount: 150,
      viewCountLastMonth: 10,
      containerName: 'Finance',
    });
  });

  it('should search content with custom limit', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({ terms: 'sales', limit: 100 });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: 'sales',
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: undefined,
    });
  });

  it('should search content with orderBy parameter', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      terms: 'dashboard',
      orderBy: [{ method: 'hitsTotal', sortDirection: 'desc' }],
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: 'dashboard',
      page: 0,
      limit: 100,
      orderBy: 'hitsTotal:desc',
      filter: undefined,
    });
  });

  it('should search content with multiple orderBy criteria', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      terms: 'dashboard',
      orderBy: [
        { method: 'hitsTotal', sortDirection: 'desc' },
        { method: 'hitsSmallSpanTotal', sortDirection: 'asc' },
      ],
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: 'dashboard',
      page: 0,
      limit: 100,
      orderBy: 'hitsTotal:desc,hitsSmallSpanTotal:asc',
      filter: undefined,
    });
  });

  it('should search content with content type filter', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      filter: { contentTypes: ['workbook', 'datasource'] },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: undefined,
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: 'type:in:[workbook,datasource]',
    });
  });

  it('should search content with single content type filter', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      filter: { contentTypes: ['workbook'] },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: undefined,
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: 'type:eq:workbook',
    });
  });

  it('should search content with owner ID filter', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      filter: { ownerIds: [123, 456] },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: undefined,
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: 'ownerId:in:[123,456]',
    });
  });

  it('should search content with modified time range filter', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      filter: {
        modifiedTime: {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-01-31T23:59:59Z',
        },
      },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: undefined,
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: 'modifiedTime:gte:2024-01-01T00:00:00Z,modifiedTime:lte:2024-01-31T23:59:59Z',
    });
  });

  it('should search content with complex filter combination', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      terms: 'sales',
      filter: {
        contentTypes: ['workbook'],
        ownerIds: [123],
        modifiedTime: {
          startDate: '2024-01-01T00:00:00Z',
        },
      },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: 'sales',
      page: 0,
      limit: 100,
      orderBy: undefined,
      filter: 'type:eq:workbook,ownerId:eq:123,modifiedTime:gte:2024-01-01T00:00:00Z',
    });
  });

  it('should allow downstreamWorkbookCount with table content type', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      orderBy: [{ method: 'downstreamWorkbookCount', sortDirection: 'desc' }],
      filter: { contentTypes: ['table'] },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: undefined,
      page: 0,
      limit: 100,
      orderBy: 'downstreamWorkbookCount:desc',
      filter: 'type:eq:table',
    });
  });

  it('should allow downstreamWorkbookCount with database content type', async () => {
    mocks.mockSearchContent.mockResolvedValue(mockSearchContentResponse);
    const result = await getToolResult({
      orderBy: [{ method: 'downstreamWorkbookCount', sortDirection: 'desc' }],
      filter: { contentTypes: ['database'] },
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockSearchContent).toHaveBeenCalledWith({
      terms: undefined,
      page: 0,
      limit: 100,
      orderBy: 'downstreamWorkbookCount:desc',
      filter: 'type:eq:database',
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Search API Error';
    mocks.mockSearchContent.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ terms: 'test' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should handle empty search results', async () => {
    const emptyResponse = {
      ...mockSearchContentResponse,
      total: 0,
      items: [],
    };
    mocks.mockSearchContent.mockResolvedValue(emptyResponse);
    const result = await getToolResult({ terms: 'nonexistent' });

    expect(result.isError).toBe(false);
    const responseData = result.content[0].text as string;
    expect(responseData).toEqual(
      'No search results were found. Either none exist or you do not have permission to view them.',
    );
  });
});

async function getToolResult(params: any): Promise<CallToolResult> {
  const searchContentTool = getSearchContentTool(new Server());
  return await searchContentTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
