import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { server } from '../../server.js';
import { listFlowsTool } from './listFlows.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

const mockFlows = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 2,
  },
  flows: [
    {
      id: 'flow1',
      name: 'SalesFlow',
      description: 'desc1',
      project: { name: 'Samples', id: 'proj1' },
      owner: { id: 'owner1' },
      webpageUrl: 'http://example.com/flow1',
      fileType: 'tfl',
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-02T00:00:00Z',
      tags: { tag: [{ label: 'tag1' }] },
      parameters: { parameter: [] },
    },
    {
      id: 'flow2',
      name: 'FinanceFlow',
      description: 'desc2',
      project: { name: 'Finance', id: 'proj2' },
      owner: { id: 'owner2' },
      webpageUrl: 'http://example.com/flow2',
      fileType: 'tfl',
      createdAt: '2023-01-03T00:00:00Z',
      updatedAt: '2023-01-04T00:00:00Z',
      tags: { tag: [{ label: 'tag2' }] },
      parameters: { parameter: [] },
    },
  ],
};

const mocks = vi.hoisted(() => ({
  mockListFlows: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    flowsMethods: {
      listFlows: mocks.mockListFlows,
    },
    siteId: 'test-site-id',
  }),
}));

describe('listFlowsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    expect(listFlowsTool.name).toBe('list-flows');
    expect(listFlowsTool.description).toContain('Retrieves a list of published Tableau Prep flows');
    expect(listFlowsTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully list flows (filter only)', async () => {
    mocks.mockListFlows.mockResolvedValue(mockFlows);
    const result = await getToolResult({ filter: 'name:eq:SalesFlow' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('SalesFlow');
    expect(mocks.mockListFlows).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:SalesFlow',
      sort: undefined,
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should successfully list flows with sort, pageSize, and limit', async () => {
    mocks.mockListFlows.mockResolvedValue(mockFlows);
    const result = await getToolResult({
      filter: 'name:eq:SalesFlow',
      sort: 'createdAt:desc',
      pageSize: 5,
      limit: 10,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockListFlows).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:SalesFlow',
      sort: 'createdAt:desc',
      pageSize: 5,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListFlows.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:SalesFlow' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should handle empty filter (list all)', async () => {
    mocks.mockListFlows.mockResolvedValue(mockFlows);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    expect(mocks.mockListFlows).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: '',
      sort: undefined,
      pageSize: undefined,
      pageNumber: undefined,
    });
  });
});

async function getToolResult(params: any): Promise<CallToolResult> {
  return await listFlowsTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
