import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function convertViewImageToToolResult(
  imageData: Buffer | string,
  format: 'PNG' | 'SVG' | undefined = 'PNG',
): CallToolResult {
  const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);

  if (format === 'SVG') {
    return {
      isError: false,
      content: [
        { type: 'text', text: buffer.toString('utf-8') },
        { type: 'image', data: buffer.toString('base64'), mimeType: 'image/svg+xml' },
      ],
    };
  }

  const base64Data = buffer.toString('base64');
  return {
    isError: false,
    content: [{ type: 'image', data: base64Data, mimeType: 'image/png' }],
  };
}
