import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockQueryViewData: vi.fn(),
  mockUploadCsvToS3: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
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

vi.mock('../../../logging/logger.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../logging/logger.js')>()),
  log: mocks.mockLog,
}));

describe('getViewDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const getViewDataTool = getGetViewDataTool(new WebMcpServer());
    expect(getViewDataTool.name).toBe('get-view-data');
    expect(getViewDataTool.description).toContain(
      "Retrieves comma-separated value (CSV) data for the specified view in a Tableau workbook, including the user's filters.",
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
  });
});

async function getToolResult({
  viewId,
  viewFilters,
}: {
  viewId: string;
  viewFilters?: Record<string, string>;
}): Promise<CallToolResult> {
  const getViewDataTool = getGetViewDataTool(new WebMcpServer());
  const callback = await Provider.from(getViewDataTool.callback);
  return await callback({ viewId, viewFilters }, getMockRequestHandlerExtra());
}
