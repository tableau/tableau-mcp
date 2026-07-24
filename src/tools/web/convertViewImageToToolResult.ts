import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function mimeTypeFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'image/svg+xml' : 'image/png';
}

/**
 * Builds a tool result that points at a rendered view image stored in S3.
 *
 * Returns a single `resource_link` content block carrying a short-lived
 * presigned URL. The client fetches the image bytes directly from S3, so the
 * MCP server never streams the image back to the client and no base64 payload
 * is inlined. The link is short-lived (see IMAGE_S3_PRESIGN_TTL_SECONDS) and
 * should be fetched promptly rather than stored.
 */
export function convertViewImageUrlToToolResult(
  url: string,
  format: 'PNG' | 'SVG' | undefined = 'PNG',
): CallToolResult {
  const resolvedFormat = format ?? 'PNG';
  return {
    isError: false,
    content: [
      {
        type: 'resource_link',
        uri: url,
        name: `view-image.${resolvedFormat === 'SVG' ? 'svg' : 'png'}`,
        mimeType: mimeTypeFor(resolvedFormat),
        description: 'Rendered view image stored in S3. This is a short-lived presigned URL.',
      },
    ],
  };
}

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
