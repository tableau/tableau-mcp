import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getListDatasourcesTool } from './listDatasources.js';

const mockDatasources = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 2,
  },
  datasources: [
    { id: 'ds1', name: 'Superstore', description: 'Sample superstore data source', project: { name: 'Samples', id: 'proj1' } },
    { id: 'ds2', name: 'Finance', description: 'Financial analysis data source', project: { name: 'Finance', id: 'proj2' } },
  ],
};

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listDatasourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listDatasourcesTool = getListDatasourcesTool(new Server());
    expect(listDatasourcesTool.name).toBe('list-datasources');
    expect(listDatasourcesTool.description).toContain('Retrieves a list of published data sources');
    expect(listDatasourcesTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully list datasources', async () => {
    mocks.mockListDatasources.mockResolvedValue(mockDatasources);
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListDatasources.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listDatasourcesTool = getListDatasourcesTool(new Server());
  return await listDatasourcesTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
