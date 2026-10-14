import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetCustomViewDataTool } from './getCustomViewData.js';
import { mockCustomView } from './mockCustomView.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockCsv = '"Country/Region,State/Province,Profit Ratio\nCanada,Alberta,19.5%\n"';

const mocks = vi.hoisted(() => ({
  mockGetCustomView: vi.fn(),
  mockGetView: vi.fn(),
  mockGetCustomViewData: vi.fn(),
  mockUpload: vi.fn(),
  mockLog: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockIsBlobStorageEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getCustomView: mocks.mockGetCustomView,
        getView: mocks.mockGetView,
        getCustomViewData: mocks.mockGetCustomViewData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  getBlobStorageProvider: vi.fn(() => ({ upload: mocks.mockUpload })),
  isBlobStorageEnabled: mocks.mockIsBlobStorageEnabled,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../logging/logger.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../logging/logger.js')>()),
  log: mocks.mockLog,
}));

describe('getCustomViewDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockGetCustomView.mockResolvedValue(mockCustomView);
    mocks.mockGetView.mockResolvedValue(mockView);
    mocks.mockGetCustomViewData.mockResolvedValue(mockCsv);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getGetCustomViewDataTool(new WebMcpServer());
    expect(tool.name).toBe('get-custom-view-data');
    expect(tool.description).toContain('custom view');
    expect(tool.paramsSchema).toMatchObject({
      customViewId: expect.any(Object),
      viewFilters: expect.any(Object),
    });
  });

  it('should successfully get custom view data', async () => {
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Country/Region');
    expect(mocks.mockGetCustomViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      viewFilters: undefined,
    });
  });

  it('should pass viewFilters to the REST layer', async () => {
    await getToolResult({ customViewId: mockCustomView.id, viewFilters: { Year: '2024' } });
    expect(mocks.mockGetCustomViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      viewFilters: { Year: '2024' },
    });
  });

  it('should handle API errors when fetching data', async () => {
    const errorMessage = 'API Error';
    mocks.mockGetCustomViewData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return not allowed when underlying view fails bounded context', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('does not belong to an allowed workbook');
    expect(mocks.mockGetCustomViewData).not.toHaveBeenCalled();
  });

  it('should return not allowed when INCLUDE_VIEW_IDS excludes the underlying view', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', 'some-other-view-id');
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      `Querying the view with LUID ${mockView.id} is not allowed.`,
    );
    // The custom view must be resolved to its underlying view id.
    expect(mocks.mockGetCustomView).toHaveBeenCalled();
    expect(mocks.mockGetCustomViewData).not.toHaveBeenCalled();
  });

  it('should successfully get custom view data when INCLUDE_VIEW_IDS contains the underlying view', async () => {
    vi.stubEnv('INCLUDE_VIEW_IDS', mockView.id);
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Country/Region');
    // The custom view is resolved once to look up its underlying view id.
    expect(mocks.mockGetCustomView).toHaveBeenCalled();
    expect(mocks.mockGetCustomViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      viewFilters: undefined,
    });
  });

  describe('blob storage data offload', () => {
    beforeEach(() => {
      // The offload path is gated behind the `view-data-file-mode` feature flag
      // and an enabled (successfully-loaded custom) blob storage provider.
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    });

    it('should return a resource_link (no inline CSV) when blob storage is enabled', async () => {
      mocks.mockUpload.mockResolvedValue({ url: 'https://blob.example.com/signed-url' });

      const result = await getToolResult({ customViewId: mockCustomView.id });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({
        type: 'resource_link',
        uri: 'https://blob.example.com/signed-url',
        name: 'view-data.csv',
        mimeType: 'text/csv',
      });
      expect(result.content.some((c) => c.type === 'text')).toBe(false);
      // No Slack _meta block is emitted for CSV data.
      expect(result._meta).toBeUndefined();

      expect(mocks.mockUpload).toHaveBeenCalledWith({
        key: `data/${mockCustomView.id}.csv`,
        data: Buffer.from(mockCsv, 'utf-8'),
        contentType: 'text/csv; charset=utf-8',
      });
    });

    it('should return inline CSV when blob storage is not enabled', async () => {
      mocks.mockIsBlobStorageEnabled.mockReturnValue(false);

      const result = await getToolResult({ customViewId: mockCustomView.id });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(JSON.stringify(mockCsv));
      expect(mocks.mockUpload).not.toHaveBeenCalled();
    });

    it('should fall back to inline CSV and warn when the blob storage upload fails', async () => {
      mocks.mockUpload.mockRejectedValue(new Error('access denied'));

      const result = await getToolResult({ customViewId: mockCustomView.id });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(JSON.stringify(mockCsv));
      expect(mocks.mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('access denied'),
        }),
      );
    });

    it('should return inline CSV (no upload) when view-data-file-mode is disabled even if blob storage is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(false);

      const result = await getToolResult({ customViewId: mockCustomView.id });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe(JSON.stringify(mockCsv));
      expect(mocks.mockUpload).not.toHaveBeenCalled();
    });
  });
});

async function getToolResult({
  customViewId,
  viewFilters,
}: {
  customViewId: string;
  viewFilters?: Record<string, string>;
}): Promise<CallToolResult> {
  const tool = getGetCustomViewDataTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      customViewId,
      viewFilters,
    },
    getMockRequestHandlerExtra(),
  );
}
