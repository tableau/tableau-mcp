import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { clearStaleContentReportCache } from './getStaleContentReport.js';
import { getQueryAdminInsightsTool } from './queryAdminInsights.js';
import { adminInsightsResolver } from './resolver.js';

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockListDatasources: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockQueryProjects: vi.fn(),
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
      projectsMethods: {
        queryProjects: mocks.mockQueryProjects,
      },
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

const validQuery: Query = {
  fields: [{ fieldCaption: 'Item ID' }],
};

describe('query-admin-insights tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminInsightsResolver.clearCache();
    clearStaleContentReportCache();

    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    // Resolver filters by projectName:eq:Admin Insights (single call) and matches datasets by name
    // client-side, so the mock returns every dataset the resolver might look up in one page.
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 3 },
      datasources: [
        { id: 'luid-tse', name: 'TS Events' },
        { id: 'luid-sc', name: 'Site Content' },
        { id: 'luid-jp', name: 'Job Performance' },
      ],
    });
    mocks.mockQueryProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 0 },
      projects: [],
    });
  });

  it('exposes the documented tool name', () => {
    const tool = getQueryAdminInsightsTool(new WebMcpServer());
    expect(tool.name).toBe('query-admin-insights');
  });

  it('dispatches kind=ts-events to the TS Events datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [{ 'Item ID': 'wb-1' }] }));

    const result = await getToolResult({ kind: 'ts-events', query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasource: { datasourceLuid: 'luid-tse' } }),
    );
  });

  it('dispatches kind=site-content to the Site Content datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [] }));

    const result = await getToolResult({ kind: 'site-content', query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasource: { datasourceLuid: 'luid-sc' } }),
    );
  });

  it('dispatches kind=job-performance to the Job Performance datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [] }));

    const result = await getToolResult({ kind: 'job-performance', query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasource: { datasourceLuid: 'luid-jp' } }),
    );
  });

  it('returns an error when a raw-VDS kind is called without a query', async () => {
    const result = await getToolResult({ kind: 'ts-events' });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.content[0].text).toContain('query is required');
  });

  it('dispatches kind=stale-content to Site Content with the stale-content query shape', async () => {
    const today = new Date();
    const veryOld = new Date(today.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString();
    mocks.mockQueryDatasource.mockResolvedValue(
      new Ok({
        data: [
          {
            'Item ID': 42,
            'Item LUID': 'wb-luid-1',
            'Item Type': 'Workbook',
            'Item Name': 'Stale WB',
            'Item Parent Project Name': 'Sales',
            'Owner Email': 'owner@example.com',
            'Created At': veryOld,
            'Updated At': veryOld,
            'Last Accessed At': veryOld,
            'Size (bytes)': 12345,
          },
        ],
      }),
    );

    const result = await getToolResult({ kind: 'stale-content' });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasource: { datasourceLuid: 'luid-sc' } }),
    );
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    const payload = JSON.parse(result.content[0].text);
    expect(payload.totalStaleItems).toBe(1);
    expect(payload.rows[0].itemLuid).toBe('wb-luid-1');
  });

  it('returns 403 when the caller is not an admin (raw VDS kind)', async () => {
    mocks.mockAssertAdmin.mockResolvedValueOnce(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );

    const result = await getToolResult({ kind: 'ts-events', query: validQuery });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.content[0].text).toContain('admin');
  });

  it('returns 403 when the caller is not an admin (stale-content kind)', async () => {
    mocks.mockAssertAdmin.mockResolvedValueOnce(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );

    const result = await getToolResult({ kind: 'stale-content' });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.content[0].text).toContain('admin');
  });
});

async function getToolResult(params: {
  kind: 'ts-events' | 'site-content' | 'job-performance' | 'stale-content';
  query?: Query;
  limit?: number;
  minAgeDays?: number;
  projectIds?: string[];
  itemTypes?: Array<'Workbook' | 'Datasource'>;
}): Promise<CallToolResult> {
  const tool = getQueryAdminInsightsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      kind: params.kind,
      query: params.query,
      limit: params.limit,
      minAgeDays: params.minAgeDays,
      projectIds: params.projectIds,
      itemTypes: params.itemTypes,
    },
    getMockRequestHandlerExtra(),
  );
}
