import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetCustomViewImageTool } from './getCustomViewImage.js';
import { mockCustomView } from './mockCustomView.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const encodedPngData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const mockPngData = Buffer.from(encodedPngData, 'base64').toString('latin1');
const base64PngData = Buffer.from(mockPngData).toString('base64');

const mocks = vi.hoisted(() => ({
  mockGetCustomView: vi.fn(),
  mockGetView: vi.fn(),
  mockGetCustomViewImage: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getCustomView: mocks.mockGetCustomView,
        getView: mocks.mockGetView,
        getCustomViewImage: mocks.mockGetCustomViewImage,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getCustomViewImageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockGetCustomView.mockResolvedValue(mockCustomView);
    mocks.mockGetView.mockResolvedValue(mockView);
    mocks.mockGetCustomViewImage.mockResolvedValue(mockPngData);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getGetCustomViewImageTool(new Server());
    expect(tool.name).toBe('get-custom-view-image');
    expect(tool.description).toContain('custom view');
    expect(tool.paramsSchema).toMatchObject({
      customViewId: expect.any(Object),
      viewFilters: expect.any(Object),
    });
  });

  it('should successfully get custom view image', async () => {
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({
      type: 'image',
      data: base64PngData,
      mimeType: 'image/png',
    });
    expect(mocks.mockGetCustomViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      resolution: 'high',
      viewFilters: undefined,
    });
  });

  it('should pass viewFilters to the REST layer', async () => {
    await getToolResult({
      customViewId: mockCustomView.id,
      viewFilters: { Region: 'West' },
    });
    expect(mocks.mockGetCustomViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      resolution: 'high',
      viewFilters: { Region: 'West' },
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGetCustomViewImage.mockRejectedValue(new Error(errorMessage));
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
    expect(mocks.mockGetCustomViewImage).not.toHaveBeenCalled();
  });
});

async function getToolResult(params: {
  customViewId: string;
  viewFilters?: Record<string, string>;
}): Promise<CallToolResult> {
  const tool = getGetCustomViewImageTool(new Server());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      customViewId: params.customViewId,
      viewFilters: params.viewFilters,
      width: undefined,
      height: undefined,
    },
    getMockRequestHandlerExtra(),
  );
}
