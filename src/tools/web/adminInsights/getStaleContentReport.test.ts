import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  clearStaleContentReportCache,
  computeStaleRows,
  exportedForTesting,
  getGetStaleContentReportTool,
} from './getStaleContentReport.js';
import { ADMIN_INSIGHTS_PROJECT_NAME, adminInsightsResolver } from './resolver.js';

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

describe('computeStaleRows', () => {
  const today = new Date('2026-05-20T00:00:00Z');

  function row(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      'Item ID': 'wb-x',
      'Item Type': 'Workbook',
      'Item Name': 'X',
      'Item Parent Project Name': 'default',
      'Owner Email': 'a@example.com',
      'Created At': '2025-12-01T00:00:00Z',
      'Updated At': '2025-12-01T00:00:00Z',
      'Last Accessed At': null,
      'Size (bytes)': 100,
      ...overrides,
    };
  }

  it('excludes rows whose daysSinceLastUse equals the threshold', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 'wb-75',
          'Last Accessed At': '2026-03-06T00:00:00Z', // 75 days before 2026-05-20
        }),
      ],
      thresholdDays: 75,
      today,
    });
    expect(rows).toHaveLength(0);
  });

  it('excludes a 75-day-stale workbook when threshold is 90 (locks the mcpJam regression)', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 'wb-1',
          'Last Accessed At': '2026-03-06T00:00:00Z',
        }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(0);
  });

  it('includes a 100-day-stale workbook when threshold is 90', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 'wb-old',
          'Last Accessed At': '2026-02-01T00:00:00Z',
        }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe('wb-old');
    expect(rows[0].neverAccessed).toBe(false);
    expect(rows[0].daysSinceLastUse).toBeGreaterThan(90);
  });

  it('surfaces Item LUID as itemLuid (the LUID delete-workbook/get-workbook require, not the integer Item ID)', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 2971061,
          'Item LUID': '2f6d87c1-8165-42f4-907d-2f0631a3c41c',
          'Created At': '2024-01-01T00:00:00Z',
          'Last Accessed At': null,
        }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(1);
    // Integer repo ID stays in itemId (back-compat); the REST-usable LUID is in itemLuid.
    expect(rows[0].itemId).toBe('2971061');
    expect(rows[0].itemLuid).toBe('2f6d87c1-8165-42f4-907d-2f0631a3c41c');
  });

  it('sets itemLuid to null when Item LUID is absent (older Site Content schemas)', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 'wb-no-luid',
          'Item LUID': undefined,
          'Created At': '2024-01-01T00:00:00Z',
          'Last Accessed At': null,
        }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].itemLuid).toBeNull();
  });

  it('falls back to Created At when Last Accessed At is null and flags neverAccessed', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 'wb-never',
          'Created At': '2025-01-01T00:00:00Z',
          'Last Accessed At': null,
        }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].neverAccessed).toBe(true);
    expect(rows[0].lastUsedDate).toBe('2025-01-01T00:00:00Z');
  });

  it('also falls back to Created At when Last Accessed At field is missing', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 'wb-noacc',
          'Item Type': 'Workbook',
          'Item Name': 'No Access Field',
          'Item Parent Project Name': 'default',
          'Created At': '2025-01-01T00:00:00Z',
          'Size (bytes)': 0,
        },
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].neverAccessed).toBe(true);
  });

  it('client-side excludes Admin Insights project rows even when VDS returns them', () => {
    const rows = computeStaleRows({
      universe: [
        row({
          'Item ID': 'wb-ai',
          'Item Parent Project Name': 'Admin Insights',
          'Created At': '2024-01-01T00:00:00Z',
          'Last Accessed At': null,
        }),
        row({
          'Item ID': 'wb-keep',
          'Item Parent Project Name': 'default',
          'Created At': '2024-01-01T00:00:00Z',
          'Last Accessed At': null,
        }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows.map((r) => r.itemId)).toEqual(['wb-keep']);
  });

  it('coerces numeric Item ID to string (Site Content VDS returns integers)', () => {
    const rows = computeStaleRows({
      universe: [
        {
          'Item ID': 5092107,
          'Item Type': 'Datasource',
          'Item Name': 'California Schools (frpm + satscores)',
          'Item Parent Project Name': 'default',
          'Owner Email': 's.montesdeoca@salesforce.com',
          'Created At': '2026-01-13T22:18:16',
          'Last Accessed At': null,
          'Size (bytes)': 1316088,
        },
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe('5092107');
    expect(rows[0].neverAccessed).toBe(true);
  });

  it('sorts descending by daysSinceLastUse, then by size', () => {
    const rows = computeStaleRows({
      universe: [
        row({ 'Item ID': 'a', 'Created At': '2026-01-01T00:00:00Z', 'Size (bytes)': 100 }),
        row({ 'Item ID': 'b', 'Created At': '2025-01-01T00:00:00Z', 'Size (bytes)': 50 }),
        row({ 'Item ID': 'c', 'Created At': '2025-01-01T00:00:00Z', 'Size (bytes)': 500 }),
      ],
      thresholdDays: 90,
      today,
    });
    expect(rows.map((r) => r.itemId)).toEqual(['c', 'b', 'a']);
  });
});

describe('buildSiteContentQuery', () => {
  it('emits the Admin Insights exclude filter when no project scope is set', () => {
    const query = exportedForTesting.buildSiteContentQuery(['Workbook', 'Datasource'], null);
    const projectFilter = query.filters?.find(
      (f) =>
        'field' in f &&
        'fieldCaption' in f.field &&
        f.field.fieldCaption === 'Item Parent Project Name' &&
        f.filterType === 'SET' &&
        'exclude' in f &&
        f.exclude === true,
    );
    expect(projectFilter).toBeDefined();
    expect(projectFilter).toMatchObject({
      field: { fieldCaption: 'Item Parent Project Name' },
      filterType: 'SET',
      values: [ADMIN_INSIGHTS_PROJECT_NAME],
      exclude: true,
    });
  });

  it('omits the include filter when scope is null', () => {
    const query = exportedForTesting.buildSiteContentQuery(['Workbook', 'Datasource'], null);
    const includeFilters = query.filters?.filter(
      (f) =>
        'field' in f &&
        'fieldCaption' in f.field &&
        f.field.fieldCaption === 'Item Parent Project Name' &&
        f.filterType === 'SET' &&
        'exclude' in f &&
        f.exclude === false,
    );
    expect(includeFilters).toEqual([]);
  });

  it('replaces the AI exclude with the project-scope include when scope is provided (VDS rejects multiple SET filters on the same field)', () => {
    const query = exportedForTesting.buildSiteContentQuery(
      ['Workbook', 'Datasource'],
      ['Finance', 'Sales'],
    );
    const projectFilters = query.filters?.filter(
      (f) =>
        'field' in f &&
        'fieldCaption' in f.field &&
        f.field.fieldCaption === 'Item Parent Project Name',
    );
    expect(projectFilters).toHaveLength(1);
    expect(projectFilters?.[0]).toMatchObject({
      field: { fieldCaption: 'Item Parent Project Name' },
      filterType: 'SET',
      values: ['Finance', 'Sales'],
      exclude: false,
    });
  });

  it('uses the documented Site Content field captions', () => {
    const query = exportedForTesting.buildSiteContentQuery(['Workbook', 'Datasource'], null);
    const captions = query.fields.map((f) => ('fieldCaption' in f ? f.fieldCaption : null));
    expect(captions).toEqual([
      'Item ID',
      'Item LUID',
      'Item Type',
      'Item Name',
      'Item Parent Project Name',
      'Owner Email',
      'Created At',
      'Updated At',
      'Last Accessed At',
      'Size (bytes)',
    ]);
  });
});

describe('resolveProjectScopeIds', () => {
  it('returns null when no scope is set', () => {
    const ids = exportedForTesting.resolveProjectScopeIds({
      argProjectIds: undefined,
      boundedProjectIds: null,
    });
    expect(ids).toBeNull();
  });

  it('returns the arg LUIDs when no bounded context is set', () => {
    const ids = exportedForTesting.resolveProjectScopeIds({
      argProjectIds: ['p-1', 'p-2'],
      boundedProjectIds: null,
    });
    expect(ids).toEqual(['p-1', 'p-2']);
  });

  it('returns the intersection when both arg and bounded context are set', () => {
    const ids = exportedForTesting.resolveProjectScopeIds({
      argProjectIds: ['p-1', 'p-other'],
      boundedProjectIds: new Set(['p-1', 'p-allowed']),
    });
    expect(ids).toEqual(['p-1']);
  });

  it('falls back to bounded context when arg is omitted', () => {
    const ids = exportedForTesting.resolveProjectScopeIds({
      argProjectIds: undefined,
      boundedProjectIds: new Set(['p-bounded']),
    });
    expect(ids).toEqual(['p-bounded']);
  });
});

describe('get-stale-content-report tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminInsightsResolver.clearCache();
    clearStaleContentReportCache();

    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));

    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
      datasources: [{ id: 'luid-sc', name: 'Site Content' }],
    });

    mocks.mockQueryProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2 },
      projects: [
        { id: 'p-1', name: 'Finance' },
        { id: 'p-2', name: 'Sales' },
      ],
    });
  });

  it('exposes the documented tool name', () => {
    const tool = getGetStaleContentReportTool(new WebMcpServer());
    expect(tool.name).toBe('get-stale-content-report');
  });

  it('runs a single Site Content VDS query and returns filtered rows', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValueOnce(
      Ok({
        data: [
          {
            'Item ID': 'wb-recent',
            'Item Type': 'Workbook',
            'Item Name': 'Recent WB',
            'Item Parent Project Name': 'default',
            'Owner Email': 'a@example.com',
            'Created At': '2025-12-01T00:00:00Z',
            'Last Accessed At': '2026-04-15T00:00:00Z',
            'Size (bytes)': 100,
          },
          {
            'Item ID': 'ds-old',
            'Item Type': 'Datasource',
            'Item Name': 'Old DS',
            'Item Parent Project Name': 'default',
            'Owner Email': 'b@example.com',
            'Created At': '2024-12-01T00:00:00Z',
            'Last Accessed At': '2025-01-01T00:00:00Z',
            'Size (bytes)': 200,
          },
          {
            'Item ID': 'wb-never',
            'Item Type': 'Workbook',
            'Item Name': 'Never Opened',
            'Item Parent Project Name': 'default',
            'Owner Email': 'c@example.com',
            'Created At': '2024-01-01T00:00:00Z',
            'Last Accessed At': null,
            'Size (bytes)': 50,
          },
        ],
      }),
    );

    const result = await getToolResult({ minAgeDays: 90 });

    expect(result.isError).toBeFalsy();
    expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1); // single VDS call

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
    expect(ids).toContain('ds-old');
    expect(ids).toContain('wb-never');
    expect(ids).not.toContain('wb-recent');
    expect(payload.rows.every((r) => r.daysSinceLastUse > 90)).toBe(true);
    const neverFlagged = payload.rows.find((r) => r.itemId === 'wb-never');
    expect(neverFlagged?.neverAccessed).toBe(true);
  });

  it('accepts rows where Item Parent Project Name is null (top-level content)', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValueOnce(
      Ok({
        data: [
          {
            'Item ID': 'wb-toplevel',
            'Item Type': 'Workbook',
            'Item Name': 'Top-Level WB',
            'Item Parent Project Name': null,
            'Owner Email': null,
            'Created At': '2024-01-01T00:00:00Z',
            'Last Accessed At': null,
            'Size (bytes)': null,
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
      rows: Array<{ itemId: string; project: string | null; ownerEmail: string | null }>;
    };
    const row = payload.rows.find((r) => r.itemId === 'wb-toplevel');
    expect(row).toBeDefined();
    expect(row?.project).toBeNull();
    expect(row?.ownerEmail).toBeNull();
  });

  it('rejects when caller is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValueOnce(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );

    const result = await getToolResult({ minAgeDays: 90 });

    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') {
      throw new Error('expected text content');
    }
    expect(result.content[0].text.toLowerCase()).toContain('admin');
  });

  it('resolves projectIds (LUIDs) → names via list-projects and applies the filter', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValueOnce(Ok({ data: [] }));

    await getToolResult({ minAgeDays: 90, projectIds: ['p-1', 'p-2'] });

    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
    const vdsCall = mocks.mockQueryDatasource.mock.calls[0][0];
    const filters = vdsCall.query.filters as Array<{
      field?: { fieldCaption?: string };
      filterType?: string;
      values?: string[];
      exclude?: boolean;
    }>;
    const includeFilter = filters.find(
      (f) =>
        f.field?.fieldCaption === 'Item Parent Project Name' &&
        f.filterType === 'SET' &&
        f.exclude === false,
    );
    expect(includeFilter).toBeDefined();
    expect(includeFilter?.values).toEqual(['Finance', 'Sales']);
  });

  it('caches list-projects per-site so a second invocation skips the REST call', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource
      .mockResolvedValueOnce(Ok({ data: [] }))
      .mockResolvedValueOnce(Ok({ data: [] }));

    await getToolResult({ minAgeDays: 90, projectIds: ['p-1'] });
    await getToolResult({ minAgeDays: 90, projectIds: ['p-2'] });

    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
  });

  it('sends the Admin Insights exclude filter to VDS when no project scope is set', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValueOnce(Ok({ data: [] }));

    await getToolResult({ minAgeDays: 90 });

    const vdsCall = mocks.mockQueryDatasource.mock.calls[0][0];
    const filters = vdsCall.query.filters as Array<{
      field?: { fieldCaption?: string };
      filterType?: string;
      values?: string[];
      exclude?: boolean;
    }>;
    const excludeFilter = filters.find(
      (f) =>
        f.field?.fieldCaption === 'Item Parent Project Name' &&
        f.filterType === 'SET' &&
        f.exclude === true,
    );
    expect(excludeFilter).toBeDefined();
    expect(excludeFilter?.values).toEqual([ADMIN_INSIGHTS_PROJECT_NAME]);
  });

  it('does NOT send a second SET filter on Item Parent Project Name when project scope is set (VDS rejects multiple SETs on same field)', async () => {
    const { Ok } = await import('ts-results-es');
    mocks.mockQueryDatasource.mockResolvedValueOnce(Ok({ data: [] }));

    await getToolResult({ minAgeDays: 90, projectIds: ['p-1'] });

    const vdsCall = mocks.mockQueryDatasource.mock.calls[0][0];
    const filters = vdsCall.query.filters as Array<{
      field?: { fieldCaption?: string };
      filterType?: string;
      values?: string[];
      exclude?: boolean;
    }>;
    const projectFilters = filters.filter(
      (f) => f.field?.fieldCaption === 'Item Parent Project Name',
    );
    expect(projectFilters).toHaveLength(1);
    expect(projectFilters[0].exclude).toBe(false);
  });
});

async function getToolResult(params: {
  minAgeDays?: number;
  projectIds?: string[];
}): Promise<CallToolResult> {
  const tool = getGetStaleContentReportTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { minAgeDays: params.minAgeDays, projectIds: params.projectIds, itemTypes: undefined },
    getMockRequestHandlerExtra(),
  );
}
