import { describe, expect, it } from 'vitest';

import { sanitizeForNotification } from './sanitizeNotification.js';

describe('sanitizeForNotification', () => {
  it('redacts Buffer payloads before JSON serialization can expand byte indexes', () => {
    const sanitized = sanitizeForNotification({
      type: 'response',
      data: Buffer.from([137, 80, 78, 71]),
    });

    expect(sanitized).toEqual({
      type: 'response',
      data: {
        redacted: true,
        reason: 'binary-payload',
        message: '[redacted binary payload]',
        kind: 'Buffer',
        byteLength: 4,
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain('"0":137');
  });

  it('redacts Uint8Array payloads before JSON serialization can expand byte indexes', () => {
    const sanitized = sanitizeForNotification({
      type: 'response',
      data: new Uint8Array([1, 2, 3]),
    });

    expect(sanitized).toEqual({
      type: 'response',
      data: {
        redacted: true,
        reason: 'binary-payload',
        message: '[redacted binary payload]',
        kind: 'Uint8Array',
        byteLength: 3,
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain('"0":1');
  });

  it('redacts large SVG strings', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect />'.repeat(20)}</svg>`;

    const sanitized = sanitizeForNotification(
      { type: 'response', data: svg },
      { maxStringLength: 32 },
    );

    expect(sanitized).toEqual({
      type: 'response',
      data: {
        redacted: true,
        reason: 'svg-xml-payload',
        message: '[redacted large SVG/XML payload]',
        mimeTypeGuess: 'image/svg+xml',
        originalLength: svg.length,
        threshold: 32,
      },
    });
  });

  it('redacts large base64 image strings', () => {
    const pngBase64 = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('image-bytes'.repeat(20)),
    ]).toString('base64');

    const sanitized = sanitizeForNotification(
      { type: 'response', data: pngBase64 },
      { maxStringLength: 32 },
    );

    expect(sanitized).toEqual({
      type: 'response',
      data: {
        redacted: true,
        reason: 'base64-image-payload',
        message: '[redacted large base64 image payload]',
        mimeTypeGuess: 'image/png',
        originalLength: pngBase64.length,
        threshold: 32,
      },
    });
  });

  it('bounds ordinary oversized strings', () => {
    const text = 'ordinary text '.repeat(20);

    const sanitized = sanitizeForNotification(
      { type: 'response', data: text },
      { maxStringLength: 32 },
    );

    expect(sanitized).toEqual({
      type: 'response',
      data: {
        truncated: true,
        reason: 'oversized-string',
        message: '[truncated oversized string]',
        value: text.slice(0, 32),
        originalLength: text.length,
        threshold: 32,
      },
    });
  });

  it('leaves small normal notification messages unchanged', () => {
    const message = {
      type: 'response',
      status: 200,
      data: { message: 'ok' },
    };

    expect(sanitizeForNotification(message)).toEqual(message);
  });

  it('does not mutate original message objects', () => {
    const message = {
      type: 'response',
      data: {
        image: Buffer.from([1, 2, 3]),
        text: 'ordinary text '.repeat(20),
      },
    };
    const originalImage = message.data.image;
    const originalText = message.data.text;

    sanitizeForNotification(message, { maxStringLength: 32 });

    expect(message.data.image).toBe(originalImage);
    expect(message.data.text).toBe(originalText);
  });
});
