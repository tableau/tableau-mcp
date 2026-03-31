import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function convertViewImageToToolResult(
  imageData: string,
  format: 'PNG' | 'SVG' | undefined = 'PNG',
): CallToolResult {
  if (format === 'SVG') {
    return {
      isError: false,
      content: [{ type: 'text', text: imageData }],
    };
  }

  const base64Data = Buffer.from(imageData).toString('base64');
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
