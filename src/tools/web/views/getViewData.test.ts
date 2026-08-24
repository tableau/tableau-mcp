import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetViewDataTool as getGetViewDataTool } from './getViewData.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockViewData =
  '"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Alberta,19.5%,53.41,-114.42\n"';
const multipartBoundary = 'view-data-boundary';
const multipartContentType = `multipart/form-data; boundary=${multipartBoundary}`;

function buildMultipartBody(
  sheets: Array<{ name: string; columns: string[]; rows: string[][]; errorDetail?: string }>,
): Buffer {
  return Buffer.from(
    [
      ...sheets.flatMap((sheet) => [
        `--${multipartBoundary}`,
        `Content-Disposition: form-data; name="${sheet.name}_payload"`,
        'Content-Type: text/csv; charset=utf-8',
        `X-Tableau-Sheet-Name: ${sheet.name}`,
        ...(sheet.errorDetail
          ? [
              'X-Tableau-Sheet-Error-Code: 400081',
              `X-Tableau-Sheet-Error-Detail: ${sheet.errorDetail}`,
              '',
              '',
            ]
          : [
              'X-Tableau-Sheet-Status: 200',
              '',
              [sheet.columns, ...sheet.rows].map((row) => row.join(',')).join('\r\n'),
            ]),
      ]),
      `--${multipartBoundary}--`,
      '',
    ].join('\r\n'),
  );
}

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockGetViewAllData: vi.fn(),
  mockQueryViewData: vi.fn(),
  mockUploadCsvToS3: vi.fn(),
  mockLog: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
        getViewAllData: mocks.mockGetViewAllData,
        queryViewData: mocks.mockQueryViewData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../uploadDataToS3.js', async (importActual) => ({
  ...(await importActual<typeof import('../uploadDataToS3.js')>()),
  uploadCsvToS3: mocks.mockUploadCsvToS3,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../logging/logger.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../logging/logger.js')>()),
  log: mocks.mockLog,
}));

describe('getViewDataTool', () => {
  const originalRestApiVersion = RestApi.version;
  const originalVersionIsAtLeast = RestApi.versionIsAtLeast;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    RestApi.version = '3.29';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    RestApi.version = originalRestApiVersion;
    RestApi.versionIsAtLeast = originalVersionIsAtLeast;
  });

  it('should create a tool instance with correct properties', () => {
    const getViewDataTool = getGetViewDataTool(new WebMcpServer());
    expect(getViewDataTool.name).toBe('get-view-data');
    expect(getViewDataTool.description).toContain(
      "Retrieves data for the specified view in a Tableau workbook, including the user's filters.",
    );
    expect(getViewDataTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view data', async () => {
    mocks.mockQueryViewData.mockResolvedValue(mockViewData);
    const result = await getToolResult({ viewId: mockView.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)',
    );
    expect(result.content[0].text).toContain('Canada,Alberta,19.5%,53.41,-114.42');
    expect(mocks.mockQueryViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: mockView.id,
    });
  });

  it('should pass viewFilters to the REST layer', async () => {
    await getToolResult({
      viewId: mockView.id,
      viewFilters: { Year: '2024' },
    });

    expect(mocks.mockQueryViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: mockView.id,
      viewFilters: { Year: '2024' },
    });
  });

  it('uses allData and returns complete parsed rows on REST API 3.30 or later', async () => {
    RestApi.version = '3.30';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(true);
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        {
          name: 'Sales',
          columns: ['Region', 'Sales'],
          rows: [
            ['West', '100'],
            ['East', '200'],
          ],
        },
      ]),
      contentType: multipartContentType,
    });

    const result = await getToolResult({ viewId: mockView.id, viewFilters: { Region: 'West' } });

    expect(parseJsonContent(result)).toEqual({
      sheetName: 'Sales',
      totalSheetsInView: 1,
      columns: ['Region', 'Sales'],
      rows: [
        ['West', '100'],
        ['East', '200'],
      ],
      sheetStatus: 'OK',
    });
    expect(mocks.mockGetViewAllData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: mockView.id,
      viewFilters: { Region: 'West' },
    });
    expect(mocks.mockQueryViewData).not.toHaveBeenCalled();
  });

  it('returns a manifest for an unselected multi-sheet view on REST API 3.30 or later', async () => {
    RestApi.version = '3.30';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(true);
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        { name: 'Sales', columns: ['Region'], rows: [['West']] },
        { name: 'Profit', columns: ['Region'], rows: [['East']] },
      ]),
      contentType: multipartContentType,
    });

    expect(parseJsonContent(await getToolResult({ viewId: mockView.id }))).toEqual({
      requiresSheetSelection: true,
      sheets: [
        { sheetName: 'Sales', sheetIndex: 0 },
        { sheetName: 'Profit', sheetIndex: 1 },
      ],
    });
  });

  it('returns the first matching selected sheet and isolates sheet errors on REST API 3.30 or later', async () => {
    RestApi.version = '3.30';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(true);
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([
        { name: 'Sales', columns: ['Region'], rows: [['West']] },
        { name: 'Sales', columns: ['Region'], rows: [['East']] },
        { name: 'Broken', columns: [], rows: [], errorDetail: 'Sheet+could+not+be+rendered' },
      ]),
      contentType: multipartContentType,
    });

    expect(
      parseJsonContent(await getToolResult({ viewId: mockView.id, sheetName: 'Sales' })),
    ).toMatchObject({
      rows: [['West']],
      sheetStatus: 'OK',
    });
    expect(
      parseJsonContent(await getToolResult({ viewId: mockView.id, sheetName: 'Broken' })),
    ).toEqual({
      sheetName: 'Broken',
      totalSheetsInView: 3,
      columns: [],
      rows: [],
      sheetStatus: 'ERROR',
      errorDetail: 'Sheet could not be rendered',
    });
  });

  it('returns an available-sheet error when the selected sheet does not exist on REST API 3.30 or later', async () => {
    RestApi.version = '3.30';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(true);
    mocks.mockGetViewAllData.mockResolvedValue({
      body: buildMultipartBody([{ name: 'Sales', columns: ['Region'], rows: [['West']] }]),
      contentType: multipartContentType,
    });

    const result = await getToolResult({ viewId: mockView.id, sheetName: 'Missing' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet "Missing" was not found');
    expect(result.content[0].text).toContain('Sales');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ viewId: mockView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return view not allowed error when view is not allowed', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');
    mocks.mockGetView.mockResolvedValue(mockView);

    const result = await getToolResult({ viewId: mockView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'The set of allowed views that can be queried is limited by the server configuration.',
        `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed workbook.`,
      ].join(' '),
    );

    expect(mocks.mockQueryViewData).not.toHaveBeenCalled();
  });

  it('should return view not allowed error when INCLUDE_VIEW_IDS excludes the view', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', 'some-other-view-id');

    const result = await getToolResult({ viewId: mockView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'The set of allowed views that can be queried is limited by the server configuration.',
        `Querying the view with LUID ${mockView.id} is not allowed.`,
      ].join(' '),
    );

    // viewIds is a synchronous Set lookup — no fetch should happen.
    expect(mocks.mockGetView).not.toHaveBeenCalled();
    expect(mocks.mockQueryViewData).not.toHaveBeenCalled();
  });

  it('should successfully get view data when INCLUDE_VIEW_IDS contains the view', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', mockView.id);
    mocks.mockQueryViewData.mockResolvedValue(mockViewData);

    const result = await getToolResult({ viewId: mockView.id });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: mockView.id,
    });
    // viewIds is a synchronous Set lookup — no need to fetch the view itself.
    expect(mocks.mockGetView).not.toHaveBeenCalled();
  });

  describe('S3 data offload', () => {
    beforeEach(() => {
      // The S3-offload path is gated behind the `view-data-file-mode` feature flag.
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      mocks.mockQueryViewData.mockResolvedValue(mockViewData);
    });

    it('should return a resource_link (no inline CSV) when MCP_S3_BUCKET is configured', async () => {
      vi.stubEnv('MCP_S3_BUCKET', 'tableau-data');
      mocks.mockUploadCsvToS3.mockResolvedValue('https://s3.example.com/signed-url');

      const result = await getToolResult({ viewId: mockView.id });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({
        type: 'resource_link',
        uri: 'https://s3.example.com/signed-url',
        name: 'view-data.csv',
        mimeType: 'text/csv',
      });
      // No inline text block is emitted when offloading to S3.
      expect(result.content.some((c) => c.type === 'text')).toBe(false);
      // No Slack _meta block is emitted for CSV data.
      expect(result._meta).toBeUndefined();

      expect(mocks.mockUploadCsvToS3).toHaveBeenCalledWith(mockViewData, {
        resourceId: mockView.id,
        config: expect.objectContaining({
          bucket: 'tableau-data',
          keyPrefix: 'view-data/',
        }),
      });
    });

    it('prefixes the S3 key with the base prefix followed by the view-data segment', async () => {
      vi.stubEnv('MCP_S3_BUCKET', 'tableau-data');
      vi.stubEnv('MCP_IMAGE_PREFIX', 'tableau/');
      mocks.mockUploadCsvToS3.mockResolvedValue('https://s3.example.com/signed-url');

      await getToolResult({ viewId: mockView.id });

      expect(mocks.mockUploadCsvToS3).toHaveBeenCalledWith(
        mockViewData,
        expect.objectContaining({
          config: expect.objectContaining({ keyPrefix: 'tableau/view-data/' }),
        }),
      );
    });

    it('should return inline CSV when MCP_S3_BUCKET is not configured', async () => {
      const result = await getToolResult({ viewId: mockView.id });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(JSON.stringify(mockViewData));
      expect(mocks.mockUploadCsvToS3).not.toHaveBeenCalled();
    });

    it('should fall back to inline CSV and warn when the S3 upload fails', async () => {
      vi.stubEnv('MCP_S3_BUCKET', 'tableau-data');
      mocks.mockUploadCsvToS3.mockRejectedValue(new Error('access denied'));

      const result = await getToolResult({ viewId: mockView.id });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(JSON.stringify(mockViewData));
      expect(mocks.mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('access denied'),
        }),
      );
    });

    it('should return inline CSV (no S3 upload) when view-data-file-mode is disabled even if MCP_S3_BUCKET is configured', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(false);
      vi.stubEnv('MCP_S3_BUCKET', 'tableau-data');

      const result = await getToolResult({ viewId: mockView.id });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(JSON.stringify(mockViewData));
      expect(mocks.mockUploadCsvToS3).not.toHaveBeenCalled();
    });
  });
});

async function getToolResult({
  viewId,
  viewFilters,
  sheetName,
}: {
  viewId: string;
  viewFilters?: Record<string, string>;
  sheetName?: string;
}): Promise<CallToolResult> {
  const getViewDataTool = getGetViewDataTool(new WebMcpServer());
  const callback = await Provider.from(getViewDataTool.callback);
  return await callback({ viewId, viewFilters, sheetName }, getMockRequestHandlerExtra());
}

function parseJsonContent(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
