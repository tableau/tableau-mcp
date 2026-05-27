import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { adminGate } from '../_lib/adminGate.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getQueryAdminInsightsTsEventsTool } from './queryTsEvents.js';
import { adminInsightsResolver } from './resolver.js';

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockListDatasources: vi.fn(),
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
      usersMethods: {
        queryUserOnSite: vi.fn().mockResolvedValue({
          id: 'user-test',
          name: 'admin',
          siteRole: 'SiteAdministratorCreator',
        }),
      },
    }),
  ),
}));

const validQuery: Query = {
  fields: [{ fieldCaption: 'Item ID' }],
};

describe('query-admin-insights-ts-events tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminInsightsResolver.clearCache();
    adminGate.clearCache();

    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      datasources: [{ id: 'luid-tse', name: 'TS Events' }],
    });
  });

  it('exposes the documented tool name', () => {
    const tool = getQueryAdminInsightsTsEventsTool(new WebMcpServer());
    expect(tool.name).toBe('query-admin-insights-ts-events');
  });

  it('runs the VDS query against the resolved TS Events LUID and returns OK', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValue(
      Ok({ data: [{ 'Item ID': 'wb-1', last_access: '2026-04-15' }] }),
    );

    const result = await getToolResult({ query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockListDatasources).toHaveBeenCalled();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({
        datasource: { datasourceLuid: 'luid-tse' },
      }),
    );
  });

  it('returns 403 when the caller is not an admin', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValue(Ok({ data: [] }));

    // Override usersMethods on the next callback to flip role
    const { useRestApi } = await import('../../../restApiInstance.js');
    (useRestApi as ReturnType<typeof vi.fn>).mockImplementationOnce(async ({ callback }) =>
      callback({
        siteId: 'site-test',
        userId: 'user-test',
        vizqlDataServiceMethods: { queryDatasource: mocks.mockQueryDatasource },
        datasourcesMethods: { listDatasources: mocks.mockListDatasources },
        usersMethods: {
          queryUserOnSite: vi
            .fn()
            .mockResolvedValue({ id: 'user-test', name: 'u', siteRole: 'Viewer' }),
        },
      }),
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
  const tool = getQueryAdminInsightsTsEventsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ query: params.query, limit: undefined }, getMockRequestHandlerExtra());
}
