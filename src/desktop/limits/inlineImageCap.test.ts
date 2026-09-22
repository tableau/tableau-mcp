import { buildInlineImageCapFileMessage } from './inlineImageCap.js';

describe('buildInlineImageCapFileMessage', () => {
  it('keeps the export-image next step and discloses manual cache-file removal by default', () => {
    const message = buildInlineImageCapFileMessage({
      label: 'Worksheet',
      bytes: 9,
      capBytes: 8,
      file: '/tmp/worksheet-image.png',
    });

    expect(message).toContain('worksheet instead of a whole dashboard');
    expect(message).toContain('pass a filePath');
    expect(message).toContain('remains until manually removed');
  });

  it('uses a capture-specific next step without unsupported export parameters', () => {
    const message = buildInlineImageCapFileMessage({
      label: 'Window screenshot (1440x900)',
      bytes: 9,
      capBytes: 8,
      file: '/tmp/window-screenshot.png',
      nextStep:
        'Open the file to view the full resolution screenshot. This local cache file remains until manually removed.',
    });

    expect(message).toContain('full resolution screenshot');
    expect(message).toContain('remains until manually removed');
    expect(message).not.toContain('filePath');
    expect(message).not.toContain('worksheet');
  });
});
