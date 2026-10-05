import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildCachedImageToolResult } from './exportSheetImageResult.js';

const doubles = vi.hoisted(() => ({
  cacheFile: '',
  constructorError: undefined as Error | undefined,
  getCacheFilePath: vi.fn(({ prefix, extension }: { prefix: string; extension: string }) =>
    join(doubles.cacheFile, `${prefix}-generated.${extension}`),
  ),
  log: vi.fn(),
}));

vi.mock('../../../desktop/cache.js', () => ({
  DesktopCache: class {
    constructor() {
      if (doubles.constructorError) throw doubles.constructorError;
    }

    getCacheFilePath = doubles.getCacheFilePath;
  },
}));
vi.mock('../../../logging/logger.js', () => ({ log: doubles.log }));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

describe('buildCachedImageToolResult', () => {
  let directory: string;

  beforeEach(() => {
    vi.clearAllMocks();
    directory = mkdtempSync(join(tmpdir(), 'tableau-image-cache-test-'));
    doubles.cacheFile = directory;
    doubles.constructorError = undefined;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes byte-identical image data exclusively with owner-only permissions after a cap hit', () => {
    const bytes = Buffer.from([0, 1, 2, 3, 254, 255]);

    const result = buildCachedImageToolResult({
      tool: 'export-worksheet-image',
      label: 'Worksheet',
      cachePrefix: 'worksheet-image',
      bytes,
      inlineBytes: bytes.length,
      capBytes: bytes.length - 1,
      mimeType: 'image/png',
    });

    expect(result).toBeDefined();
    expect(result?.isError).toBe(false);
    expect(result?.content.some((block) => block.type === 'image')).toBe(false);
    expect(result).not.toHaveProperty('structuredContent');
    const cacheFile = join(directory, 'worksheet-image-generated.png');
    expect(readFileSync(cacheFile)).toEqual(bytes);
    if (process.platform !== 'win32') expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(cacheFile, bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    expect(result?.content[0]?.type).toBe('text');
    if (result?.content[0]?.type === 'text') {
      expect(result.content[0].text).toContain(`Image file: ${cacheFile}`);
      expect(result.content[0].text).toContain('remains until manually removed');
    }
    expect(doubles.log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(doubles.log.mock.calls)).not.toContain(bytes.toString('base64'));
  });

  it('does no cache I/O or cap-hit logging when inline bytes equal the cap', () => {
    const result = buildCachedImageToolResult({
      tool: 'capture-window-screenshot',
      label: 'Window screenshot (10x20)',
      cachePrefix: 'window-screenshot',
      bytes: Buffer.from([1, 2, 3]),
      inlineBytes: 3,
      capBytes: 3,
      mimeType: 'image/png',
    });

    expect(result).toBeUndefined();
    expect(doubles.getCacheFilePath).not.toHaveBeenCalled();
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(doubles.log).not.toHaveBeenCalled();
  });

  it('throws a generic path-free error and does not log when the exclusive cache write fails', () => {
    const nativePath = join(directory, 'window-screenshot-generated.png');
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error(`EEXIST: file already exists, open '${nativePath}'`);
    });

    let thrown: unknown;
    try {
      buildCachedImageToolResult({
        tool: 'capture-window-screenshot',
        label: 'Window screenshot (10x20)',
        cachePrefix: 'window-screenshot',
        bytes: Buffer.from([1, 2, 3, 4]),
        inlineBytes: 4,
        capBytes: 3,
        mimeType: 'image/png',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not write the image to the local cache.');
    expect((thrown as Error).message).not.toContain(nativePath);
    expect(doubles.log).not.toHaveBeenCalled();
  });

  it('sanitizes cache path allocation failures before any write or cap-hit log', () => {
    const nativePath = join(directory, 'private-cache-path');
    doubles.getCacheFilePath.mockImplementationOnce(() => {
      throw new Error(`EACCES: permission denied, mkdir '${nativePath}'`);
    });

    let thrown: unknown;
    try {
      buildCachedImageToolResult({
        tool: 'capture-window-screenshot',
        label: 'Window screenshot (10x20)',
        cachePrefix: 'window-screenshot',
        bytes: Buffer.from([1, 2, 3, 4]),
        inlineBytes: 4,
        capBytes: 3,
        mimeType: 'image/png',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not write the image to the local cache.');
    expect((thrown as Error).message).not.toContain(nativePath);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(doubles.log).not.toHaveBeenCalled();
  });

  it('sanitizes cache initialization failures before path allocation, write, or logging', () => {
    const nativePath = join(directory, 'private-cache-directory');
    doubles.constructorError = new Error(`EACCES: permission denied, mkdir '${nativePath}'`);

    let thrown: unknown;
    try {
      buildCachedImageToolResult({
        tool: 'capture-window-screenshot',
        label: 'Window screenshot (10x20)',
        cachePrefix: 'window-screenshot',
        bytes: Buffer.from([1, 2, 3, 4]),
        inlineBytes: 4,
        capBytes: 3,
        mimeType: 'image/png',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Could not write the image to the local cache.');
    expect((thrown as Error).message).not.toContain(nativePath);
    expect(doubles.getCacheFilePath).not.toHaveBeenCalled();
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(doubles.log).not.toHaveBeenCalled();
  });

  it('preserves a preexisting cache file when the exclusive write collides', () => {
    const cacheFile = join(directory, 'window-screenshot-generated.png');
    const retained = Buffer.from('preexisting content');
    writeFileSync(cacheFile, retained);
    vi.mocked(writeFileSync).mockClear();

    expect(() =>
      buildCachedImageToolResult({
        tool: 'capture-window-screenshot',
        label: 'Window screenshot (10x20)',
        cachePrefix: 'window-screenshot',
        bytes: Buffer.from('new screenshot'),
        inlineBytes: 14,
        capBytes: 1,
        mimeType: 'image/png',
      }),
    ).toThrow('Could not write the image to the local cache.');

    expect(readFileSync(cacheFile)).toEqual(retained);
    expect(doubles.log).not.toHaveBeenCalled();
  });
});
