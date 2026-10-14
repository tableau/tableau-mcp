import {
  convertViewImageToToolResult,
  convertViewImageUrlToToolResult,
} from './convertViewImageToToolResult.js';

describe('convertViewImageUrlToToolResult', () => {
  const url = 'https://s3.example.com/view-images/abc/uuid.png?signature=xyz';

  it('returns a single resource_link block for PNG (default)', () => {
    const result = convertViewImageUrlToToolResult(url);
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: 'resource_link',
      uri: url,
      name: 'view-image.png',
      mimeType: 'image/png',
      description: 'Rendered view image stored in blob storage.',
    });
  });

  it('uses an svg name and mime type for SVG', () => {
    const result = convertViewImageUrlToToolResult(url, 'SVG');
    expect(result.content[0]).toMatchObject({
      type: 'resource_link',
      uri: url,
      name: 'view-image.svg',
      mimeType: 'image/svg+xml',
    });
  });

  it('defaults an undefined format to PNG', () => {
    const result = convertViewImageUrlToToolResult(url, undefined);
    expect(result.content[0]).toMatchObject({ name: 'view-image.png', mimeType: 'image/png' });
  });

  it('never inlines a base64 image block', () => {
    const result = convertViewImageUrlToToolResult(url, 'PNG');
    expect(result.content.some((c) => c.type === 'image')).toBe(false);
  });

  it('emits a Slack image block pointing at the presigned URL for PNG', () => {
    const result = convertViewImageUrlToToolResult(url, 'PNG');
    expect(result._meta).toEqual({
      slack: {
        blocks: [{ type: 'image', image_url: url, alt_text: 'Tableau view image' }],
      },
    });
  });

  it('defaults an undefined format to a PNG Slack image block', () => {
    const result = convertViewImageUrlToToolResult(url, undefined);
    expect(result._meta?.slack).toMatchObject({
      blocks: [{ type: 'image', image_url: url }],
    });
  });

  it('does not emit a Slack image block for SVG', () => {
    const result = convertViewImageUrlToToolResult(url, 'SVG');
    expect(result._meta).toBeUndefined();
  });
});

describe('convertViewImageToToolResult', () => {
  it('returns a base64 image block for PNG', () => {
    const buffer = Buffer.from('png-bytes');
    const result = convertViewImageToToolResult(buffer, 'PNG');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('returns both text and image blocks for SVG', () => {
    const svg = '<svg></svg>';
    const result = convertViewImageToToolResult(Buffer.from(svg), 'SVG');
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: 'text', text: svg });
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/svg+xml' });
  });
});
