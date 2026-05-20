import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { adminGate } from '../../../prompts/_lib/adminGate.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  computeStaleRows,
  exportedForTesting,
  getGetStaleContentReportTool,
} from './getStaleContentReport.js';
import { ADMIN_INSIGHTS_PROJECT_NAME, adminInsightsResolver } from './resolver.js';

const mocks = vi.hoisted(() => ({
  mockQueryDatasource: vi.fn(),
  mockListDatasources: vi.fn(),
  mockGetUser: vi.fn(),
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
        getUser: mocks.mockGetUser,
      },
    }),
  ),
}));

describe('computeStaleRows', () => {
  const today = new Date('2026-05-17T00:00:00Z');

  it('excludes rows whose days_stale equals the threshold', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'wb-75',
          'Item Type': 'Workbook',
          'Item Name': 'Recent Workbook',
          Project: 'Default',
          'Owner Email': 'a@example.com',
          'Created At': '2026-01-01T00:00:00Z',
          Size: 1024,
        },
      ],
      lastAccess: new Map([['Workbook:wb-75', '2026-03-03T00:00:00Z']]),
      thresholdDays: 75,
      projectScope: { mode: 'all' },
      today,
    });
    expect(rows).toHaveLength(0);
  });

  it('excludes a 75-day-stale workbook when threshold is 90', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'wb-1',
          'Item Type': 'Workbook',
          'Item Name': 'TS Users',
          Project: 'Admin Insights',
          'Owner Email': 'admin@example.com',
          'Created At': '2026-01-01T00:00:00Z',
          Size: 2048,
        },
      ],
      lastAccess: new Map([['Workbook:wb-1', '2026-03-03T00:00:00Z']]),
      thresholdDays: 90,
      projectScope: { mode: 'all' },
      today,
    });
    expect(rows).toHaveLength(0);
  });

  it('includes a 100-day-stale workbook when threshold is 90', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'wb-old',
          'Item Type': 'Workbook',
          'Item Name': 'Old Wb',
          Project: 'Default',
          'Owner Email': 'old@example.com',
          'Created At': '2026-01-01T00:00:00Z',
          Size: 4096,
        },
      ],
      lastAccess: new Map([['Workbook:wb-old', '2026-02-01T00:00:00Z']]),
      thresholdDays: 90,
      projectScope: { mode: 'all' },
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe('wb-old');
    expect(rows[0].neverAccessed).toBe(false);
    expect(rows[0].daysSinceLastUse).toBeGreaterThan(90);
  });

  it('treats never-accessed items by COALESCE(last_access, Created At) and flags them', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'wb-never',
          'Item Type': 'Workbook',
          'Item Name': 'Never Opened',
          'Created At': '2025-01-01T00:00:00Z',
          Size: 0,
        },
      ],
      lastAccess: new Map(),
      thresholdDays: 90,
      projectScope: { mode: 'all' },
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].neverAccessed).toBe(true);
    expect(rows[0].lastUsedDate).toBe('2025-01-01T00:00:00Z');
  });

  it('sorts descending by daysSinceLastUse, then by size', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'a',
          'Item Type': 'Workbook',
          'Item Name': 'A',
          'Created At': '2026-01-01T00:00:00Z',
          Size: 100,
        },
        {
          'Item ID': 'b',
          'Item Type': 'Workbook',
          'Item Name': 'B',
          'Created At': '2025-01-01T00:00:00Z',
          Size: 50,
        },
        {
          'Item ID': 'c',
          'Item Type': 'Workbook',
          'Item Name': 'C',
          'Created At': '2025-01-01T00:00:00Z',
          Size: 500,
        },
      ],
      lastAccess: new Map(),
      thresholdDays: 90,
      projectScope: { mode: 'all' },
      today,
    });
    expect(rows.map((r) => r.itemId)).toEqual(['c', 'b', 'a']);
  });

  it('filters by project scope when restricted', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'wb-in',
          'Item Type': 'Workbook',
          'Item Name': 'In',
          'Project ID': 'p-allowed',
          'Created At': '2025-01-01T00:00:00Z',
          Size: 1,
        },
        {
          'Item ID': 'wb-out',
          'Item Type': 'Workbook',
          'Item Name': 'Out',
          'Project ID': 'p-other',
          'Created At': '2025-01-01T00:00:00Z',
          Size: 1,
        },
      ],
      lastAccess: new Map(),
      thresholdDays: 90,
      projectScope: { mode: 'restricted', ids: new Set(['p-allowed']) },
      today,
    });
    expect(rows.map((r) => r.itemId)).toEqual(['wb-in']);
  });
});

describe('get-stale-content-report tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminInsightsResolver.clearCache();
    adminGate.clearCache();

    mocks.mockGetUser.mockResolvedValue({
      id: 'user-test',
      name: 'admin',
      siteRole: 'SiteAdministratorCreator',
    });

    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 2 },
      datasources: [
        { id: 'luid-tse', name: 'TS Events' },
        { id: 'luid-sc', name: 'Site Content' },
      ],
    });
  });

  it('exposes the documented tool name', () => {
    const tool = getGetStaleContentReportTool(new WebMcpServer());
    expect(tool.name).toBe('get-stale-content-report');
  });

  it('runs both VDS queries, anti-joins, applies threshold, and returns filtered rows', async () => {
    const { Ok } = await import('ts-results-es');
    const todayIso = new Date().toISOString();
    void todayIso;

    mocks.mockQueryDatasource
      .mockResolvedValueOnce(
        Ok({
          data: [
            { 'Item ID': 'wb-1', 'Item Type': 'Workbook', last_access: '2026-03-03T00:00:00Z' },
            { 'Item ID': 'ds-2', 'Item Type': 'Datasource', last_access: '2025-01-01T00:00:00Z' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Ok({
          data: [
            {
              'Item ID': 'wb-1',
              'Item Type': 'Workbook',
              'Item Name': 'Recent WB',
              Project: 'Default',
              'Owner Email': 'a@example.com',
              'Created At': '2025-12-01T00:00:00Z',
              Size: 100,
            },
            {
              'Item ID': 'ds-2',
              'Item Type': 'Datasource',
              'Item Name': 'Old DS',
              Project: 'Default',
              'Owner Email': 'b@example.com',
              'Created At': '2024-12-01T00:00:00Z',
              Size: 200,
            },
            {
              'Item ID': 'wb-3',
              'Item Type': 'Workbook',
              'Item Name': 'Never Opened',
              Project: 'Default',
              'Owner Email': 'c@example.com',
              'Created At': '2024-01-01T00:00:00Z',
              Size: 50,
            },
          ],
        }),
      );

    const result = await getToolResult({ minAgeDays: 90 });

    expect(result.isError).toBeFalsy();
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    const payload = JSON.parse(result.content[0].text) as {
      thresholdDays: number;
      totalStaleItems: number;
      rows: Array<{ itemId: string; daysSinceLastUse: number; neverAccessed: boolean }>;
    };

    expect(payload.thresholdDays).toBe(90);
    const ids = payload.rows.map((r) => r.itemId);
    expect(ids).toContain('ds-2');
    expect(ids).toContain('wb-3');
    expect(ids).not.toContain('wb-1'); // 75-ish days, would be < 90 only if today is 2026-05-17
    expect(payload.rows.every((r) => r.daysSinceLastUse > 90)).toBe(true);
    const neverFlagged = payload.rows.find((r) => r.itemId === 'wb-3');
    expect(neverFlagged?.neverAccessed).toBe(true);
  });

  it('rejects when caller is not an admin', async () => {
    mocks.mockGetUser.mockResolvedValueOnce({
      id: 'user-test',
      name: 'viewer',
      siteRole: 'Viewer',
    });

    const result = await getToolResult({ minAgeDays: 90 });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.content[0].text.toLowerCase()).toContain('admin');
  });

  describe('Admin Insights project exclusion', () => {
    it('buildSiteContentQuery emits an exclude filter on Project for "Admin Insights"', () => {
      const query = exportedForTesting.buildSiteContentQuery(['Workbook', 'Datasource']);
      const projectFilter = query.filters?.find(
        (f) =>
          'field' in f &&
          'fieldCaption' in f.field &&
          f.field.fieldCaption === 'Project' &&
          f.filterType === 'SET',
      );
      expect(projectFilter).toBeDefined();
      expect(projectFilter).toMatchObject({
        field: { fieldCaption: 'Project' },
        filterType: 'SET',
        values: [ADMIN_INSIGHTS_PROJECT_NAME],
        exclude: true,
      });
    });

    it('sends the Admin Insights exclude filter to VDS on the Site Content query', async () => {
      const { Ok } = await import('ts-results-es');
      mocks.mockQueryDatasource
        .mockResolvedValueOnce(Ok({ data: [] }))
        .mockResolvedValueOnce(Ok({ data: [] }));

      await getToolResult({ minAgeDays: 90 });

      // Two VDS calls: TS Events (1st), Site Content (2nd)
      expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(2);
      const siteContentCall = mocks.mockQueryDatasource.mock.calls[1][0];
      const filters = siteContentCall.query.filters as Array<{
        field?: { fieldCaption?: string };
        filterType?: string;
        values?: string[];
        exclude?: boolean;
      }>;
      const projectExclude = filters.find(
        (f) => f.field?.fieldCaption === 'Project' && f.filterType === 'SET' && f.exclude === true,
      );
      expect(projectExclude).toBeDefined();
      expect(projectExclude?.values).toEqual([ADMIN_INSIGHTS_PROJECT_NAME]);
    });

    it('computeStaleRows still passes Admin Insights rows when given to it (exclusion happens at VDS layer, not in TS)', () => {
      // Negative-control: documents that the post-processor is unchanged.
      // Exclusion is enforced upstream at query time. If the VDS filter is ever
      // bypassed, this test will keep passing — the failing layer is the query
      // builder, covered by the test above.
      const today = new Date('2026-05-20T00:00:00Z');
      const rows = computeStaleRows({
        universe: [
          {
            'Item ID': 'ai-1',
            'Item Type': 'Datasource',
            'Item Name': 'TS Users',
            Project: ADMIN_INSIGHTS_PROJECT_NAME,
            'Owner Email': 'admin@example.com',
            'Created At': '2024-01-01T00:00:00Z',
            Size: 999,
          },
        ],
        lastAccess: new Map(),
        thresholdDays: 90,
        projectScope: { mode: 'all' },
        today,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].project).toBe(ADMIN_INSIGHTS_PROJECT_NAME);
    });
  });
});

async function getToolResult(params: {
  minAgeDays?: number;
  projectIds?: string[];
}): Promise<CallToolResult> {
  const tool = getGetStaleContentReportTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      minAgeDays: params.minAgeDays,
      projectIds: params.projectIds,
      itemTypes: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}
