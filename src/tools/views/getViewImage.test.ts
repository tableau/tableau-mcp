import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { stubDefaultEnvVars } from '../../testShared.js';
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
    const getViewImageTool = getGetViewImageTool(new Server());
    expect(getViewImageTool.name).toBe('get-view-image');
    expect(getViewImageTool.description).toContain(
      'Retrieves an image of the specified view in a Tableau workbook.',
    );
    expect(getViewImageTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view image as PNG when format is omitted', async () => {
    mocks.mockQueryViewImage.mockResolvedValue(mockPngData);
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
    mocks.mockQueryViewImage.mockResolvedValue(mockSvgData);
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
    mocks.mockQueryViewImage.mockResolvedValue(svgBuffer);
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
    mocks.mockQueryViewImage.mockRejectedValue(new Error(errorMessage));
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
});

async function getToolResult(params: {
  viewId: string;
  format?: 'PNG' | 'SVG';
}): Promise<CallToolResult> {
  const getViewImageTool = getGetViewImageTool(new Server());
  const callback = await Provider.from(getViewImageTool.callback);
  return await callback(
    { viewId: params.viewId, width: undefined, height: undefined, format: params.format },
    getMockRequestHandlerExtra(),
  );
}
