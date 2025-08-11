import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function convertPngDataToToolResult(pngData: string): CallToolResult {
  const base64Data = Buffer.from(pngData).toString('base64');
  const size = Buffer.from(base64Data, 'base64').length;

  return {
    isError: false,
    content: [
      {
        type: 'image',
        data: base64Data,
        mimeType: 'image/png',
        annotations: {
          size: size,
        },
      },
    ],
  };
}
