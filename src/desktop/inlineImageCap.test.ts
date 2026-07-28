import { sniffImageMimeType } from './inlineImageCap.js';

describe('sniffImageMimeType', () => {
  it.each([
    {
      name: 'PNG magic bytes',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      expected: 'image/png',
    },
    {
      name: 'bare <svg',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      expected: 'image/svg+xml',
    },
    {
      name: '<?xml prolog after leading whitespace',
      bytes: Buffer.from('\n  <?xml version="1.0"?><svg/>'),
      expected: 'image/svg+xml',
    },
    {
      name: 'UTF-8 BOM before <?xml',
      bytes: Buffer.from('﻿<?xml version="1.0"?><svg/>'),
      expected: 'image/svg+xml',
    },
    {
      name: 'non-image text falls back to png',
      bytes: Buffer.from('not an image at all'),
      expected: 'image/png',
    },
    {
      name: 'empty buffer falls back to png',
      bytes: Buffer.alloc(0),
      expected: 'image/png',
    },
  ])('sniffs $name as $expected', ({ bytes, expected }) => {
    expect(sniffImageMimeType(bytes)).toBe(expected);
  });
});
