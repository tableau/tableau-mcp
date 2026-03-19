import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function convertPngDataToToolResult(pngData: string): CallToolResult {
  /** REST clients return PNG bytes as a binary string; `latin1` preserves all byte values for base64 encoding. */
  const base64Data = Buffer.from(pngData, 'latin1').toString('base64');

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
