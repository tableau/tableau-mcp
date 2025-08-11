import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getQueryViewImageTool } from './queryViewImage.js';

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

describe('queryViewImageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const queryViewImageTool = getQueryViewImageTool(new Server());
    expect(queryViewImageTool.name).toBe('query-view-image');
    expect(queryViewImageTool.description).toContain('Retrieves an image of the specified view.');
    expect(queryViewImageTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
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
      annotations: { size: 82 },
    });
    expect(mocks.mockQueryViewImage).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
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
  const queryViewImageTool = getQueryViewImageTool(new Server());
  return await queryViewImageTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
