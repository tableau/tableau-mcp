import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function convertViewImageToToolResult(
  imageData: Buffer | string,
  format: 'PNG' | 'SVG' | undefined = 'PNG',
): CallToolResult {
  const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData as string);

  if (format === 'SVG') {
    return {
      isError: false,
      content: [{ type: 'text', text: buffer.toString('utf-8') }],
    };
  }

  const base64Data = buffer.toString('base64');
  return {
    isError: false,
    content: [{ type: 'image', data: base64Data, mimeType: 'image/png' }],
  };
}
