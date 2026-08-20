import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import invariant from '../../../utils/invariant.js';
import {
  buildWindowScreenshotToolResult,
  chooseMainWindowImage,
  extractScreenshotPaths,
  resolveImageFiles,
} from './captureWindowScreenshot.js';

// statSync / readdirSync / readFileSync are stubbed per-test so resolveImageFiles and
// chooseMainWindowImage run against synthetic files; writeFileSync is stubbed so the
// over-cap path never touches disk.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Synthetic fs.Stats-ish objects: only the fields resolveImageFiles reads.
const fileStat = (size: number): unknown => ({ size, isDirectory: () => false });
const dirStat = (): unknown => ({ size: 0, isDirectory: () => true });

describe('extractScreenshotPaths', () => {
  it('reads a single TempFilePath string', () => {
    expect(extractScreenshotPaths({ TempFilePath: '/tmp/shot.png' })).toEqual(['/tmp/shot.png']);
  });

  it('reads an array of paths', () => {
    expect(extractScreenshotPaths({ TempFilePath: ['/tmp/a.png', '/tmp/b.png'] })).toEqual([
      '/tmp/a.png',
      '/tmp/b.png',
    ]);
  });

  it('tolerates alternate key casings', () => {
    expect(extractScreenshotPaths({ tempFilePath: '/tmp/x.png' })).toEqual(['/tmp/x.png']);
    expect(extractScreenshotPaths({ temp_file_path: '/tmp/y.png' })).toEqual(['/tmp/y.png']);
  });

  it('drops blank / non-string entries', () => {
    expect(extractScreenshotPaths({ TempFilePath: ['', '  ', 3, '/tmp/z.png'] })).toEqual([
      '/tmp/z.png',
    ]);
    expect(extractScreenshotPaths({ TempFilePath: '   ' })).toEqual([]);
  });

  it('returns [] for a missing/empty result', () => {
    expect(extractScreenshotPaths(undefined)).toEqual([]);
    expect(extractScreenshotPaths({})).toEqual([]);
    expect(extractScreenshotPaths({ Other: 'value' })).toEqual([]);
  });
});

describe('resolveImageFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expands a temp DIRECTORY to the ScreenShot_*.png files inside it', () => {
    // The real shape: TempFilePath is the temp dir, holding one PNG per widget.
    vi.mocked(statSync).mockImplementation((() => dirStat()) as never);
    vi.mocked(readdirSync).mockReturnValue([
      'ScreenShot_0.png',
      'ScreenShot_1.png',
      'notes.txt',
    ] as never);

    expect(resolveImageFiles(['/tmp/tableau-temp/abc'])).toEqual([
      '/tmp/tableau-temp/abc/ScreenShot_0.png',
      '/tmp/tableau-temp/abc/ScreenShot_1.png',
    ]);
  });

  it('passes a plain file path through unchanged', () => {
    vi.mocked(statSync).mockImplementation((() => fileStat(10)) as never);
    expect(resolveImageFiles(['/tmp/shot.png'])).toEqual(['/tmp/shot.png']);
  });

  it('skips a directory that cannot be read and an unstattable entry', () => {
    vi.mocked(statSync).mockImplementation(((path: string) => {
      if (path === '/tmp/gone') {
        throw new Error('ENOENT');
      }
      return dirStat() as never;
    }) as never);
    vi.mocked(readdirSync).mockImplementation((() => {
      throw new Error('EACCES');
    }) as never);

    expect(resolveImageFiles(['/tmp/gone', '/tmp/locked'])).toEqual([]);
  });
});

describe('chooseMainWindowImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('picks the largest file (the main window) among several captures', () => {
    const sizes: Record<string, number> = {
      '/tmp/dialog.png': 500,
      '/tmp/main.png': 9000,
      '/tmp/tooltip.png': 100,
    };
    vi.mocked(statSync).mockImplementation(((path: string) => fileStat(sizes[path])) as never);
    vi.mocked(readFileSync).mockImplementation(((path: string) =>
      Buffer.from(`bytes:${path}`)) as never);

    const chosen = chooseMainWindowImage(['/tmp/dialog.png', '/tmp/main.png', '/tmp/tooltip.png']);

    expect(chosen?.path).toBe('/tmp/main.png');
    expect(chosen?.bytes.toString()).toBe('bytes:/tmp/main.png');
  });

  it('picks the largest ScreenShot_*.png when handed the temp directory', () => {
    // End-to-end of the real shape: a single directory in, main window (largest) out.
    const sizes: Record<string, number> = {
      '/tmp/td/ScreenShot_0.png': 9000, // main window
      '/tmp/td/ScreenShot_1.png': 400, // a floating dialog
    };
    vi.mocked(statSync).mockImplementation(((path: string) =>
      path === '/tmp/td' ? dirStat() : fileStat(sizes[path])) as never);
    vi.mocked(readdirSync).mockReturnValue(['ScreenShot_0.png', 'ScreenShot_1.png'] as never);
    vi.mocked(readFileSync).mockImplementation(((path: string) =>
      Buffer.from(`bytes:${path}`)) as never);

    const chosen = chooseMainWindowImage(['/tmp/td']);
    expect(chosen?.path).toBe('/tmp/td/ScreenShot_0.png');
  });

  it('skips paths that cannot be stat’d and still returns a readable one', () => {
    vi.mocked(statSync).mockImplementation(((path: string) => {
      if (path === '/tmp/gone.png') {
        throw new Error('ENOENT');
      }
      return fileStat(42) as never;
    }) as never);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('ok') as never);

    const chosen = chooseMainWindowImage(['/tmp/gone.png', '/tmp/here.png']);
    expect(chosen?.path).toBe('/tmp/here.png');
  });

  it('returns null when no path is readable', () => {
    vi.mocked(statSync).mockImplementation((() => {
      throw new Error('ENOENT');
    }) as never);

    expect(chooseMainWindowImage(['/tmp/a.png', '/tmp/b.png'])).toBeNull();
    expect(chooseMainWindowImage([])).toBeNull();
  });
});

describe('buildWindowScreenshotToolResult', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the PNG inline as a base64 image block when under the cap', () => {
    const bytes = Buffer.from('a small png');
    const result = buildWindowScreenshotToolResult({
      image: { path: '/tmp/main.png', bytes },
      config: { inlineImageMaxBytes: 1024 * 1024 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'image');
    expect(result.content[0].mimeType).toBe('image/png');
    expect(result.content[0].data).toBe(bytes.toString('base64'));
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  it('writes to a cache file and returns its path when over the cap', () => {
    const bytes = Buffer.from('x'.repeat(2048));
    const result = buildWindowScreenshotToolResult({
      image: { path: '/tmp/main.png', bytes },
      config: { inlineImageMaxBytes: 512 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    // The cap message names a file rather than inlining the bytes.
    expect(result.content[0].text).toMatch(/\.png/);
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledOnce();
  });
});
