import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetViewDataTool } from './getViewData.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;
const boundary = 'all-data-boundary';
const contentType = `multipart/form-data; boundary=${boundary}`;

type FixtureSheet = {
  name: string;
  header: string[];
  rows: string[][];
  errorCode?: string;
  errorDetail?: string;
};

function buildMultipartBody(sheets: FixtureSheet[]): Buffer {
  const lines: string[] = [];
  for (const sheet of sheets) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Disposition: form-data; name="${sheet.name}_payload"`);
    lines.push('Content-Type: text/csv; charset=utf-8');
    lines.push(`X-Tableau-Sheet-Name: ${sheet.name}`);
    if (sheet.errorCode) {
      lines.push('X-Tableau-Sheet-Status: 422');
      lines.push(`X-Tableau-Sheet-Error-Code: ${sheet.errorCode}`);
      lines.push(`X-Tableau-Sheet-Error-Detail: ${sheet.errorDetail ?? ''}`);
      lines.push('', '');
    } else {
      lines.push('X-Tableau-Sheet-Status: 200', '');
      lines.push([sheet.header, ...sheet.rows].map((row) => row.join(',')).join('\r\n'));
    }
  }
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n'));
}

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockGetViewAllData: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
        getViewAllData: mocks.mockGetViewAllData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getViewDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('registers sheet selection, pagination, and filter parameters', () => {
    const tool = getGetViewDataTool(new WebMcpServer());
    expect(tool.name).toBe('get-view-data');
    expect(tool.paramsSchema).toMatchObject({
      viewId: expect.any(Object),
      sheetName: expect.any(Object),
      maxRows: expect.any(Object),
      pageToken: expect.any(Object),
      viewFilters: expect.any(Object),
    });
  });

  it('fetches a single sheet and passes viewFilters to allData', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([{ name: 'Sales', header: ['Region'], rows: [['West']] }]),
      contentType,
    });

    const result = await getToolResult({ viewId: 'view-single', viewFilters: { Region: 'West' } });

    expect(parseJsonContent(result)).toEqual({
      sheetName: 'Sales',
      totalSheetsInView: 1,
      columns: ['Region'],
      rows: [['West']],
      rowCountInPage: 1,
      isTruncated: false,
      sheetStatus: 'OK',
    });
    expect(mocks.mockGetViewAllData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: 'view-single',
      viewFilters: { Region: 'West' },
    });
  });

  it('returns a sheet manifest for a multi-sheet view and reuses the cached fetch', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        { name: 'Sales', header: ['Region'], rows: [['West']] },
        { name: 'Profit', header: ['Region'], rows: [['East']] },
      ]),
      contentType,
    });

    expect(parseJsonContent(await getToolResult({ viewId: 'view-multi' }))).toEqual({
      requiresSheetSelection: true,
      sheets: [
        { sheetName: 'Sales', sheetIndex: 0 },
        { sheetName: 'Profit', sheetIndex: 1 },
      ],
    });
    expect(
      parseJsonContent(await getToolResult({ viewId: 'view-multi', sheetName: 'Profit' })),
    ).toMatchObject({
      sheetName: 'Profit',
      rows: [['East']],
    });
    expect(mocks.mockGetViewAllData).toHaveBeenCalledTimes(1);
  });

  it('does not share cached results between different viewFilters', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([{ name: 'Sales', header: ['Region'], rows: [['West']] }]),
      contentType,
    });

    await getToolResult({ viewId: 'view-filtered', viewFilters: { Region: 'West' } });
    await getToolResult({ viewId: 'view-filtered', viewFilters: { Region: 'East' } });

    expect(mocks.mockGetViewAllData).toHaveBeenCalledTimes(2);
  });

  it('normalizes vf-prefixed filter names when caching', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([{ name: 'Sales', header: ['Region'], rows: [['West']] }]),
      contentType,
    });

    await getToolResult({ viewId: 'view-filter-prefix', viewFilters: { Region: 'West' } });
    await getToolResult({ viewId: 'view-filter-prefix', viewFilters: { vf_Region: 'West' } });

    expect(mocks.mockGetViewAllData).toHaveBeenCalledTimes(1);
  });

  it('paginates through cached rows', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        { name: 'Sales', header: ['Region'], rows: [['West'], ['East'], ['North']] },
      ]),
      contentType,
    });

    const firstPage = parseJsonContent(await getToolResult({ viewId: 'view-paged', maxRows: 2 }));
    expect(firstPage).toMatchObject({ rows: [['West'], ['East']], isTruncated: true });

    const secondPage = parseJsonContent(
      await getToolResult({ viewId: 'view-paged', maxRows: 2, pageToken: firstPage.nextPageToken }),
    );
    expect(secondPage).toMatchObject({ rows: [['North']], isTruncated: false });
    expect(mocks.mockGetViewAllData).toHaveBeenCalledTimes(1);
  });

  it('rejects a page token from a different filter set', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([{ name: 'Sales', header: ['Region'], rows: [['West'], ['East']] }]),
      contentType,
    });

    const firstPage = parseJsonContent(
      await getToolResult({ viewId: 'view-token', maxRows: 1, viewFilters: { Region: 'West' } }),
    );
    const result = await getToolResult({
      viewId: 'view-token',
      pageToken: firstPage.nextPageToken,
      viewFilters: { Region: 'East' },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('does not match the requested view and filters');
  });

  it('rejects a page token when sheetName changes', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        { name: 'Sales', header: ['Region'], rows: [['West'], ['East']] },
        { name: 'Profit', header: ['Region'], rows: [['North'], ['South']] },
      ]),
      contentType,
    });

    const firstPage = parseJsonContent(
      await getToolResult({ viewId: 'view-token-sheet', sheetName: 'Sales', maxRows: 1 }),
    );
    const result = await getToolResult({
      viewId: 'view-token-sheet',
      sheetName: 'Profit',
      pageToken: firstPage.nextPageToken,
    });

    expect(result.isError).toBe(true);
  });

  it('returns failed sheet details without throwing', async () => {
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        { name: 'Broken', header: [], rows: [], errorCode: '400081', errorDetail: 'Not+available' },
      ]),
      contentType,
    });

    expect(parseJsonContent(await getToolResult({ viewId: 'view-error' }))).toMatchObject({
      sheetName: 'Broken',
      rows: [],
      sheetStatus: 'ERROR',
      errorDetail: 'Not available',
    });
  });

  it('does not fetch disallowed views', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', 'some-other-view-id');

    const result = await getToolResult({ viewId: mockView.id });

    expect(result.isError).toBe(true);
    expect(mocks.mockGetViewAllData).not.toHaveBeenCalled();
  });
});

function parseJsonContent(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getToolResult({
  viewId,
  sheetName,
  maxRows,
  pageToken,
  viewFilters,
}: {
  viewId: string;
  sheetName?: string;
  maxRows?: number;
  pageToken?: string;
  viewFilters?: Record<string, string>;
}): Promise<CallToolResult> {
  const callback = await Provider.from(getGetViewDataTool(new WebMcpServer()).callback);
  return await callback(
    { viewId, sheetName, maxRows, pageToken, viewFilters },
    getMockRequestHandlerExtra(),
  );
}
