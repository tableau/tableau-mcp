import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { OverridableConfig } from '../../../overridableConfig.js';
import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { clearStaleContentReportCache } from './getStaleContentReport.js';
import { getQueryAdminInsightsTool } from './queryAdminInsights.js';
import { adminInsightsResolver } from './resolver.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
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

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
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
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 4 },
      datasources: [
        { id: 'luid-tse', name: 'TS Events' },
        { id: 'luid-tsu', name: 'TS Users' },
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

  it.each([
    [true, true, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])(
    'ADMIN_TOOLS_ENABLED=%s, admin-tools flag=%s → disabled=%s',
    async (adminToolsEnabled, flag, disabled) => {
      vi.stubEnv('ADMIN_TOOLS_ENABLED', String(adminToolsEnabled));
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => flag && featureName === 'admin-tools',
      );
      try {
        const tool = getQueryAdminInsightsTool(new WebMcpServer());
        expect(await Provider.from(tool.disabled)).toBe(disabled);
      } finally {
        vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
      }
    },
  );

  it('dispatches kind=ts-events to the TS Events datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [{ 'Item ID': 'wb-1' }] }));

    const result = await getToolResult({ kind: 'ts-events', query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasource: { datasourceLuid: 'luid-tse' } }),
    );
  });

  it('dispatches kind=ts-users to the TS Users datasource', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [{ 'User Email': 'a@b.com' }] }));

    const result = await getToolResult({ kind: 'ts-users', query: validQuery });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasource: { datasourceLuid: 'luid-tsu' } }),
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

  it('returns full rows when the stale count is below the configured cap', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: makeStaleRows(1) }));

    const result = await getToolResult({ kind: 'stale-content', staleContentMaxRows: '2' });

    const payload = parseStalePayload(result);
    expect(payload.totalStaleItems).toBe(1);
    expect(payload.rows).toHaveLength(1);
    expect(payload.mcp).toBeUndefined();
  });

  it('returns full rows when the stale count is exactly at the cap', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: makeStaleRows(2) }));

    const result = await getToolResult({ kind: 'stale-content', staleContentMaxRows: '2' });

    const payload = parseStalePayload(result);
    expect(payload.totalStaleItems).toBe(2);
    expect(payload.rows).toHaveLength(2);
    expect(payload.mcp).toBeUndefined();
  });

  it('withholds rows and emits ROW_CAP_EXCEEDED when the stale count is above the cap', async () => {
    const rows = makeStaleRows(5);
    const expectedTotalSize = rows.reduce((sum, r) => sum + (r['Size (bytes)'] as number), 0);
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: rows }));

    const result = await getToolResult({ kind: 'stale-content', staleContentMaxRows: '2' });

    expect(result.isError).toBeFalsy();
    const payload = parseStalePayload(result);
    // rows withheld, but the TRUE pre-cap totals are still reported.
    expect(payload.rows).toEqual([]);
    expect(payload.totalStaleItems).toBe(5);
    expect(payload.totalStaleSizeBytes).toBe(expectedTotalSize);

    const capWarning = payload.mcp?.warnings.find((w) => w.type === 'ROW_CAP_EXCEEDED');
    expect(capWarning).toMatchObject({
      type: 'ROW_CAP_EXCEEDED',
      severity: 'ERROR',
      totalStaleItems: 5,
      maxRows: 2,
      reason: 'over-row-cap',
    });
  });

  it('preserves a co-occurring PROJECT_IDS_IGNORED warning alongside ROW_CAP_EXCEEDED when over the cap', async () => {
    // One requested projectId resolves ("proj-known" -> "Sales") so a scope survives (avoids the
    // widening-guard early return); the other ("proj-unknown") is unknown on the site and produces
    // a PROJECT_IDS_IGNORED warning. The stale result also exceeds the cap, so both warnings must
    // be present on the over-cap path — guarding against a refactor dropping pre-existing warnings.
    mocks.mockQueryProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 1 },
      projects: [{ id: 'proj-known', name: 'Sales' }],
    });
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: makeStaleRows(5) }));

    const result = await getToolResult({
      kind: 'stale-content',
      projectIds: ['proj-known', 'proj-unknown'],
      staleContentMaxRows: '2',
    });

    const payload = parseStalePayload(result);
    expect(payload.rows).toEqual([]);
    expect(payload.totalStaleItems).toBe(5);

    const projectWarning = payload.mcp?.warnings.find((w) => w.type === 'PROJECT_IDS_IGNORED');
    expect(projectWarning).toMatchObject({
      type: 'PROJECT_IDS_IGNORED',
      reason: 'unknown-on-site',
      ignoredProjectIds: ['proj-unknown'],
    });

    const capWarning = payload.mcp?.warnings.find((w) => w.type === 'ROW_CAP_EXCEEDED');
    expect(capWarning).toMatchObject({
      type: 'ROW_CAP_EXCEEDED',
      severity: 'ERROR',
      totalStaleItems: 5,
      maxRows: 2,
      reason: 'over-row-cap',
    });
  });

  it('returns an empty stale-content report (0 rows, no warnings) without tripping the cap path', async () => {
    // Explicit empty-result case: Site Content returns no rows at all, so the anti-join yields
    // 0 stale items. The result must be a clean structured success — totalStaleItems 0, empty rows,
    // and NO mcp.warnings (in particular no ROW_CAP_EXCEEDED, since 0 is not > the cap).
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [] }));

    const result = await getToolResult({ kind: 'stale-content', staleContentMaxRows: '2' });

    expect(result.isError).toBeFalsy();
    const payload = parseStalePayload(result);
    expect(payload.totalStaleItems).toBe(0);
    expect(payload.totalStaleSizeBytes).toBe(0);
    expect(payload.rows).toEqual([]);
    expect(payload.mcp).toBeUndefined();
  });

  it('surfaces a VDS error on the stale-content branch instead of a false empty success', async () => {
    // Regression guard: a failed Site Content query must propagate as an error result, NOT be
    // swallowed into rows:[] (which reads identically to "no stale content found").
    mocks.mockQueryDatasource.mockResolvedValue(
      new Err({
        type: 'api-error',
        message: 'VDS exploded',
        httpStatus: 400,
        errorCode: '400000',
      }),
    );

    const result = await getToolResult({ kind: 'stale-content' });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    // The AdminInsightsUnavailableError wraps the underlying VDS message.
    expect(result.content[0].text).toContain('VDS exploded');
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

  it('applies the configured cap when lower than the requested limit', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [] }));

    await getToolResult({
      kind: 'ts-events',
      query: validQuery,
      limit: 50,
      maxResultLimits: 'query-admin-insights:10',
    });

    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ rowLimit: 11 }) }),
    );
  });

  it('applies the requested limit when no cap is configured', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [] }));

    await getToolResult({ kind: 'site-content', query: validQuery, limit: 50 });

    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ rowLimit: 51 }) }),
    );
  });

  it('applies the requested limit when it is lower than the configured cap', async () => {
    mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: [] }));

    await getToolResult({
      kind: 'job-performance',
      query: validQuery,
      limit: 20,
      maxResultLimits: 'query-admin-insights:100',
    });

    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ rowLimit: 21 }) }),
    );
  });

  describe('row limit truncation', () => {
    const rows = (n: number): { data: Array<Record<string, unknown>> } => ({
      data: Array.from({ length: n }, (_, i) => ({ 'Item ID': `wb-${i}` })),
    });

    async function getParsed(params: Parameters<typeof getToolResult>[0]): Promise<any> {
      const result = await getToolResult(params);
      expect(result.isError).toBeFalsy();
      if (result.content[0].type !== 'text') {
        throw new Error('expected text content');
      }
      return JSON.parse(result.content[0].text);
    }

    const sentRowLimits = (): unknown[] =>
      mocks.mockQueryDatasource.mock.calls.map((call) => call[0].options.rowLimit);

    it('reports admin-cap truncation and trims to the tool cap', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({
        kind: 'ts-events',
        query: validQuery,
        maxResultLimits: 'query-admin-insights:2',
      });

      expect(sentRowLimits()).toEqual([3]);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'admin-cap' },
      });
    });

    it('reports admin-cap from the global MAX_RESULT_LIMIT fallback', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({
        kind: 'ts-users',
        query: validQuery,
        limit: 10000,
        maxResultLimit: '2',
      });

      expect(sentRowLimits()).toEqual([3]);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'admin-cap' },
      });
    });

    it('does not report truncation when exactly the limit rows match', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({
        kind: 'site-content',
        query: validQuery,
        maxResultLimits: 'query-admin-insights:3',
      });

      expect(parsed.data).toHaveLength(3);
      expect(parsed.mcp).toEqual({ resultInfo: { returnedCount: 3, truncated: false } });
    });

    it('reports requested-limit when the caller limit binds under a larger cap', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({
        kind: 'job-performance',
        query: validQuery,
        limit: 2,
        maxResultLimits: 'query-admin-insights:10',
      });

      expect(sentRowLimits()).toEqual([3]);
      expect(parsed.data).toHaveLength(2);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'requested-limit' },
      });
    });

    it('sends no rowLimit and adds no mcp key when no limit or cap applies', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({ kind: 'ts-events', query: validQuery });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options).not.toHaveProperty('rowLimit');
      expect(parsed).toEqual(rows(3));
    });

    it('keeps the requested rowLimit within int32 for a maximal cap', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({
        kind: 'ts-events',
        query: validQuery,
        maxResultLimits: 'query-admin-insights:2147483647',
      });

      expect(sentRowLimits()).toEqual([2147483647]);
      expect(parsed.mcp).toEqual({ resultInfo: { returnedCount: 3, truncated: false } });
    });

    it('clamps a caller limit above int32 instead of rejecting it', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(3)));

      const parsed = await getParsed({ kind: 'ts-events', query: validQuery, limit: 5000000000 });

      expect(sentRowLimits()).toEqual([2147483647]);
      expect(parsed.mcp).toEqual({ resultInfo: { returnedCount: 3, truncated: false } });
    });

    describe('with duplicate Site Content datasources', () => {
      beforeEach(() => {
        mocks.mockListDatasources.mockResolvedValue({
          pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 2 },
          datasources: [
            {
              id: 'luid-canonical',
              name: 'Site Content',
              contentUrl: 'SiteContent',
              isCertified: true,
              project: { id: 'proj-top', name: 'Admin Insights' },
            },
            {
              id: 'luid-clone',
              name: 'Site Content',
              contentUrl: 'SiteContent_16639515632470',
              isCertified: false,
              project: { id: 'proj-top', name: 'Admin Insights' },
            },
          ],
        });
        mocks.mockQueryProjects.mockResolvedValue({
          pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
          projects: [{ id: 'proj-top', name: 'Admin Insights', topLevelProject: true }],
        });
      });

      it('returns resolver warnings and resultInfo together', async () => {
        mocks.mockQueryDatasource.mockResolvedValue(new Ok(rows(1)));

        const parsed = await getParsed({ kind: 'site-content', query: validQuery, limit: 5 });

        expect(parsed.mcp.warnings.map((w: { type: string }) => w.type)).toEqual([
          'ADMIN_INSIGHTS_AMBIGUOUS_DATASOURCE',
        ]);
        expect(parsed.mcp.resultInfo).toEqual({ returnedCount: 1, truncated: false });
      });

      it('sends the extra row on the Hyper-fallback retry and still trims', async () => {
        mocks.mockQueryDatasource
          .mockResolvedValueOnce(
            new Err({
              type: 'api-error',
              message: '[Extract][SQLSTATE:08001] could not connect to the Hyper server',
              httpStatus: 500,
              errorCode: undefined,
            }),
          )
          .mockResolvedValueOnce(new Ok(rows(3)));

        const parsed = await getParsed({
          kind: 'site-content',
          query: validQuery,
          maxResultLimits: 'query-admin-insights:2',
        });

        expect(mocks.mockQueryDatasource.mock.calls.map((c) => c[0].datasource)).toEqual([
          { datasourceLuid: 'luid-canonical' },
          { datasourceLuid: 'luid-clone' },
        ]);
        expect(sentRowLimits()).toEqual([3, 3]);
        expect(parsed.data).toHaveLength(2);
        expect(parsed.mcp.warnings.map((w: { type: string }) => w.type)).toContain(
          'ADMIN_INSIGHTS_DATASOURCE_UNHEALTHY',
        );
        expect(parsed.mcp.resultInfo).toEqual({
          returnedCount: 2,
          truncated: true,
          truncationReason: 'admin-cap',
        });
      });
    });

    it('leaves stale-content without a rowLimit or resultInfo under a cap', async () => {
      mocks.mockQueryDatasource.mockResolvedValue(new Ok({ data: makeStaleRows(1) }));

      const result = await getToolResult({
        kind: 'stale-content',
        limit: 1,
        maxResultLimits: 'query-admin-insights:1',
      });

      expect(mocks.mockQueryDatasource.mock.calls[0][0].options).not.toHaveProperty('rowLimit');
      expect(parseStalePayload(result).mcp).toBeUndefined();
    });
  });
});

// Builds `count` Site Content rows old enough to be flagged stale (last accessed ~400 days ago).
// Distinct itemIds/sizes so totals are non-trivial.
function makeStaleRows(count: number): Array<Record<string, unknown>> {
  const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
  return Array.from({ length: count }, (_, i) => ({
    'Item ID': i + 1,
    'Item LUID': `wb-luid-${i + 1}`,
    'Item Type': 'Workbook',
    'Item Name': `Stale WB ${i + 1}`,
    'Item Parent Project Name': 'Sales',
    'Owner Email': 'owner@example.com',
    'Created At': veryOld,
    'Updated At': veryOld,
    'Last Accessed At': veryOld,
    'Size (bytes)': 1000 + i,
  }));
}

type StaleContentPayload = {
  thresholdDays: number;
  totalStaleItems: number;
  totalStaleSizeBytes: number;
  rows: unknown[];
  mcp?: { warnings: Array<{ type: string; [key: string]: unknown }> };
};

function parseStalePayload(result: CallToolResult): StaleContentPayload {
  expect(result.isError).toBeFalsy();
  if (result.content[0].type !== 'text') {
    throw new Error('expected text content');
  }
  return JSON.parse(result.content[0].text) as StaleContentPayload;
}

async function getToolResult(params: {
  kind: 'ts-events' | 'ts-users' | 'site-content' | 'job-performance' | 'stale-content';
  query?: Query;
  limit?: number;
  minAgeDays?: number;
  projectIds?: string[];
  itemTypes?: Array<'Workbook' | 'Datasource'>;
  maxResultLimit?: string;
  maxResultLimits?: string;
  staleContentMaxRows?: string;
}): Promise<CallToolResult> {
  const tool = getQueryAdminInsightsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = getMockRequestHandlerExtra();
  if (
    params.maxResultLimit !== undefined ||
    params.maxResultLimits !== undefined ||
    params.staleContentMaxRows !== undefined
  ) {
    const siteOverrides: Record<string, string> = {};
    if (params.maxResultLimit !== undefined) {
      siteOverrides.MAX_RESULT_LIMIT = params.maxResultLimit;
    }
    if (params.maxResultLimits !== undefined) {
      siteOverrides.MAX_RESULT_LIMITS = params.maxResultLimits;
    }
    if (params.staleContentMaxRows !== undefined) {
      siteOverrides.STALE_CONTENT_MAX_ROWS = params.staleContentMaxRows;
    }
    extra.getConfigWithOverrides = vi.fn().mockResolvedValue(new OverridableConfig(siteOverrides));
  }
  return await callback(
    {
      kind: params.kind,
      query: params.query,
      limit: params.limit,
      minAgeDays: params.minAgeDays,
      projectIds: params.projectIds,
      itemTypes: params.itemTypes,
    },
    extra,
  );
}
