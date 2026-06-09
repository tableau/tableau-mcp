import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getQueryAdminInsightsJobPerformanceTool } from './queryJobPerformance.js';
import { adminInsightsResolver } from './resolver.js';

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockListDatasources: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'site-test',
      userId: 'user-test',
      vizqlDataServiceMethods: {
        queryDatasource: mocks.mockQueryDatasource,
      },
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
      },
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

const validQuery: Query = {
  fields: [{ fieldCaption: 'Job ID' }],
};

describe('query-admin-insights-job-performance tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminInsightsResolver.clearCache();

    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      datasources: [{ id: 'luid-jp', name: 'Job Performance' }],
    });
  });

  it('exposes the documented tool name', () => {
    const tool = getQueryAdminInsightsJobPerformanceTool(new WebMcpServer());
    expect(tool.name).toBe('query-admin-insights-job-performance');
  });

  it('runs the VDS query against the resolved Job Performance LUID and returns OK', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(
      new Ok({ data: [{ 'Job ID': 'job-1', 'Started At': '2026-05-01T10:00:00Z' }] }),
    );

    const result = await getToolResult({ query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockListDatasources).toHaveBeenCalled();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({
        datasource: { datasourceLuid: 'luid-jp' },
      }),
    );
  });

  it('returns 403 when the caller is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValueOnce(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );

    const result = await getToolResult({ query: validQuery });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.content[0].text).toContain('admin');
  });
});

async function getToolResult(params: { query: Query }): Promise<CallToolResult> {
  const tool = getQueryAdminInsightsJobPerformanceTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ query: params.query, limit: undefined }, getMockRequestHandlerExtra());
}
