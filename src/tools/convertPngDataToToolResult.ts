import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function convertPngDataToToolResult(pngData: string): CallToolResult {
  const base64Data = Buffer.from(pngData).toString('base64');

  return {
    isError: false,
    content: [
      {
        type: 'image',
        data: base64Data,
        mimeType: 'image/png',
      },
    ],
  };
}
