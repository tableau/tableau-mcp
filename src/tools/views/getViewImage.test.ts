import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { WebMcpServer } from '../../server.web.js';
import { stubDefaultEnvVars, testProductVersion } from '../../testShared.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetViewImageTool } from './getViewImage.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

// 1x1 png image
const encodedPngData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const mockPngData = Buffer.from(encodedPngData, 'base64').toString();
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
  mockGetView: vi.fn(),
  mockQueryViewImage: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
        queryViewImage: mocks.mockQueryViewImage,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getViewImageTool', () => {
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
    const getViewImageTool = getGetViewImageTool(new WebMcpServer(), testProductVersionWithSvg);
    expect(getViewImageTool.name).toBe('get-view-image');
    expect(getViewImageTool.description).toContain(
      'Retrieves an image of the specified view in a Tableau workbook.',
    );
    expect(getViewImageTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view image as PNG when format is omitted', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(Ok(mockPngData));
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({
      type: 'image',
      data: base64PngData,
      mimeType: 'image/png',
    });
    expect(mocks.mockQueryViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: undefined,
    });
  });

  it('should call queryViewImage with format SVG and return both text and image content', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(Ok(mockSvgData));
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      format: 'SVG',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text', text: mockSvgData });
    expect(result.content[1]).toMatchObject({
      type: 'image',
      data: Buffer.from(mockSvgData).toString('base64'),
      mimeType: 'image/svg+xml',
    });
    expect(mocks.mockQueryViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: 'SVG',
    });
  });

  it('should return both text and image content with SVG decoded from a Buffer', async () => {
    const svgBuffer = Buffer.from(mockSvgData, 'utf-8');
    mocks.mockQueryViewImage.mockResolvedValue(Ok(svgBuffer));
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      format: 'SVG',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text', text: mockSvgData });
    expect(result.content[1]).toMatchObject({
      type: 'image',
      data: svgBuffer.toString('base64'),
      mimeType: 'image/svg+xml',
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewImage.mockResolvedValue(
      Err({
        type: 'unknown',
        message: errorMessage,
      }),
    );
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
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
        'The view with LUID 4d18c547-bbb1-4187-ae5a-7f78b35adf2d cannot be queried because it does not belong to an allowed workbook.',
      ].join(' '),
    );

    expect(mocks.mockQueryViewImage).not.toHaveBeenCalled();
  });

  it('should return error when SVG format is requested on old Tableau version', async () => {
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      format: 'SVG',
      productVersion: testProductVersionWithoutSvg,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'SVG format requires Tableau Server 2026.2.0 or later',
    );
    expect(result.content[0].text).toContain('2026.1.0');
    expect(mocks.mockQueryViewImage).not.toHaveBeenCalled();
  });

  it('should omit format parameter when PNG is requested on old Tableau version', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(Ok(mockPngData));
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      format: 'PNG',
      productVersion: testProductVersionWithoutSvg,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: undefined,
    });
  });

  it('should include format parameter when PNG is requested on new Tableau version', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(Ok(mockPngData));
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      format: 'PNG',
      productVersion: testProductVersionWithSvg,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: 'PNG',
    });
  });

  it('should allow SVG format on new Tableau version', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(Ok(mockSvgData));
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      format: 'SVG',
      productVersion: testProductVersionWithSvg,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
      width: undefined,
      height: undefined,
      resolution: 'high',
      format: 'SVG',
    });
  });

  it('should handle 403157 FEATURE_DISABLED error', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(
      Err({
        type: 'feature-disabled',
      }),
    );
    const result = await getToolResult({
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
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
  viewId: string;
  format?: 'PNG' | 'SVG';
  viewFilters?: Record<string, string>;
  productVersion?: ProductVersion;
}): Promise<CallToolResult> {
  const getViewImageTool = getGetViewImageTool(
    new WebMcpServer(),
    params.productVersion ?? testProductVersionWithSvg,
  );
  const callback = await Provider.from(getViewImageTool.callback);
  return await callback(
    {
      viewId: params.viewId,
      width: undefined,
      height: undefined,
      format: params.format,
      viewFilters: params.viewFilters,
    },
    getMockRequestHandlerExtra(),
  );
}
