import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { Server } from '../../server.js';
import { stubDefaultEnvVars, testProductVersion } from '../../testShared.js';
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

const mockSvgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';

// Version that supports SVG format (2026.2.0+)
const testProductVersionWithSvg: ProductVersion = {
  value: '2026.2.0',
  build: '20262.26.0101.1234',
};

// Version that doesn't support SVG format (older than 2026.2.0)
const testProductVersionWithoutSvg: ProductVersion = testProductVersion; // 2026.1.0

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
    const tool = getGetCustomViewImageTool(new Server(), testProductVersionWithSvg);
    expect(tool.name).toBe('get-custom-view-image');
    expect(tool.description).toContain('custom view');
    expect(tool.paramsSchema).toMatchObject({
      customViewId: expect.any(Object),
      viewFilters: expect.any(Object),
    });
  });

  it('should successfully get custom view image as PNG when format is omitted', async () => {
    mocks.mockGetCustomViewImage.mockResolvedValue(Ok(mockPngData));
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
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: undefined,
      viewFilters: undefined,
    });
  });

  it('should call queryViewImage with format SVG and return both text and image content', async () => {
    mocks.mockGetCustomViewImage.mockResolvedValue(Ok(mockSvgData));
    const result = await getToolResult({ customViewId: mockCustomView.id, format: 'SVG' });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text', text: mockSvgData });
    expect(result.content[1]).toMatchObject({
      type: 'image',
      data: Buffer.from(mockSvgData).toString('base64'),
      mimeType: 'image/svg+xml',
    });
    expect(mocks.mockGetCustomViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: 'SVG',
      viewFilters: undefined,
    });
  });

  it('should return both text and image content with SVG decoded from a Buffer', async () => {
    const svgBuffer = Buffer.from(mockSvgData, 'utf-8');
    mocks.mockGetCustomViewImage.mockResolvedValue(Ok(svgBuffer));
    const result = await getToolResult({ customViewId: mockCustomView.id, format: 'SVG' });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text', text: mockSvgData });
    expect(result.content[1]).toMatchObject({
      type: 'image',
      data: svgBuffer.toString('base64'),
      mimeType: 'image/svg+xml',
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
      width: undefined,
      height: undefined,
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

  it('should return error when SVG format is requested on old Tableau version', async () => {
    const result = await getToolResult({
      customViewId: mockCustomView.id,
      format: 'SVG',
      productVersion: testProductVersionWithoutSvg,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'SVG format requires Tableau Server 2026.2.0 or later',
    );
    expect(result.content[0].text).toContain('2026.1.0');
    expect(mocks.mockGetCustomViewImage).not.toHaveBeenCalled();
  });

  it('should omit format parameter when PNG is requested on old Tableau version', async () => {
    mocks.mockGetCustomViewImage.mockResolvedValue(Ok(mockPngData));
    const result = await getToolResult({
      customViewId: mockCustomView.id,
      format: 'PNG',
      productVersion: testProductVersionWithoutSvg,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockGetCustomViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: undefined,
      viewFilters: undefined,
    });
  });

  it('should include format parameter when PNG is requested on new Tableau version', async () => {
    mocks.mockGetCustomViewImage.mockResolvedValue(Ok(mockPngData));
    const result = await getToolResult({
      customViewId: mockCustomView.id,
      format: 'PNG',
      productVersion: testProductVersionWithSvg,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockGetCustomViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: 'PNG',
    });
  });

  it('should allow SVG format on new Tableau version', async () => {
    mocks.mockGetCustomViewImage.mockResolvedValue(Ok(mockSvgData));
    const result = await getToolResult({
      customViewId: mockCustomView.id,
      format: 'SVG',
      productVersion: testProductVersionWithSvg,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockGetCustomViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: 'SVG',
    });
  });

  it('should handle 403157 FEATURE_DISABLED error', async () => {
    mocks.mockGetCustomViewImage.mockResolvedValue(
      Err({
        type: 'feature-disabled',
      }),
    );
    const result = await getToolResult({
      customViewId: mockCustomView.id,
      format: 'SVG',
      productVersion: testProductVersionWithSvg,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'The image format feature is disabled on this Tableau Server',
    );
  });
});

async function getToolResult(params: {
  customViewId: string;
  format?: 'PNG' | 'SVG';
  productVersion?: ProductVersion;
  viewFilters?: Record<string, string>;
}): Promise<CallToolResult> {
  const tool = getGetCustomViewImageTool(
    new Server(),
    params.productVersion ?? testProductVersionWithSvg,
  );

  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      customViewId: params.customViewId,
      width: undefined,
      height: undefined,
      format: params.format,
      viewFilters: params.viewFilters,
    },
    getMockRequestHandlerExtra(),
  );
}
