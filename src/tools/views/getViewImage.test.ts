import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getGetViewImageTool } from './getViewImage.js';

// 1x1 png image
const encodedPngData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const mockPngData = Buffer.from(encodedPngData, 'base64').toString();
const base64PngData = Buffer.from(mockPngData).toString('base64');

const mocks = vi.hoisted(() => ({
  mockQueryViewImage: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbookMethods: {
        queryViewImage: mocks.mockQueryViewImage,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getViewImageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const getViewImageTool = getGetViewImageTool(new Server());
    expect(getViewImageTool.name).toBe('get-view-image');
    expect(getViewImageTool.description).toContain(
      'Retrieves an image of the specified view in a Tableau workbook.',
    );
    expect(getViewImageTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view image', async () => {
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
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewImage.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { viewId: string }): Promise<CallToolResult> {
  const getViewImageTool = getGetViewImageTool(new Server());
  return await getViewImageTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
