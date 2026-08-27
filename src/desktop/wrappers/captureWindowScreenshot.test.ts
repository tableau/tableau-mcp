import {
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  type Stats,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { Err, Ok } from 'ts-results-es';
import { deflateSync } from 'zlib';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import {
  captureWindowScreenshot,
  MAX_WINDOW_SCREENSHOT_AGGREGATE_BYTES,
  MAX_WINDOW_SCREENSHOT_BYTES,
  MAX_WINDOW_SCREENSHOT_CANDIDATES,
  type WindowScreenshotFileSystem,
} from './captureWindowScreenshot.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.byteLength);
  return chunk;
}

function ihdr(
  width: number,
  height: number,
  format: { bitDepth?: number; colorType?: number } = {},
): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = format.bitDepth ?? 8;
  data[9] = format.colorType ?? 6;
  return pngChunk('IHDR', data);
}

function png(width: number, height: number, noisy = false): Buffer {
  const rowBytes = width * 4 + 1;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    pixels[row * rowBytes] = 0;
    if (noisy) {
      for (let column = 1; column < rowBytes; column += 1) {
        pixels[row * rowBytes + column] = (row * 131 + column * 17) & 0xff;
      }
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND'),
  ]);
}

function structurallyCompletePng(width: number, height: number): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk('IEND'),
  ]);
}

function withoutStableInode(stats: Stats): Stats {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats) as Stats;
  Object.defineProperty(copy, 'ino', { value: 0, configurable: true });
  return copy;
}

function completedCommand(parsedResult: unknown): {
  command_id: string;
  status: 'completed';
  submitted_at: string;
  parsedResult: unknown;
} {
  return {
    command_id: 'capture-1',
    status: 'completed' as const,
    submitted_at: '2026-08-27T00:00:00.000Z',
    parsedResult,
  };
}

describe('captureWindowScreenshot', () => {
  const signal = new AbortController().signal;
  const canonicalTempRoot = realpathSync(tmpdir());
  const cleanupRoots: string[] = [];

  afterEach(() => {
    for (const root of cleanupRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function commandDirectory(label = 'capture'): string {
    const directory = mkdtempSync(join(canonicalTempRoot, `tableau-${label}-`));
    cleanupRoots.push(directory);
    return directory;
  }

  function executorReturning(parsedResult: unknown): ExternalApiToolExecutor {
    return makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(Ok(completedCommand(parsedResult))),
    });
  }

  function captureFrom(directory: string): ReturnType<typeof captureWindowScreenshot> {
    return captureWindowScreenshot({
      executor: executorReturning({ tempFilePath: directory }),
      signal,
    });
  }

  it('calls the exact manual screenshot command and returns the copied PNG metadata', async () => {
    const directory = commandDirectory();
    const expected = png(1200, 800);
    writeFileSync(join(directory, 'ScreenShot_1.png'), expected);
    const executor = executorReturning({ tempFilePath: directory });

    const result = await captureWindowScreenshot({ executor, signal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ bytes: expected, width: 1200, height: 800 });
    }
    expect(executor.executeCommand).toHaveBeenCalledOnce();
    const call = vi.mocked(executor.executeCommand).mock.calls[0][0];
    expect(call).toMatchObject({
      namespace: 'tabui',
      command: 'take-all-screenshots',
      args: { HideMouse: true },
      signal,
    });
    expect(call.schema?.safeParse({ tempFilePath: directory }).success).toBe(true);
    expect(call.schema?.safeParse({ TempFilePath: directory }).success).toBe(false);
    expect(call.schema?.safeParse({ filePath: directory }).success).toBe(false);
    expect(call.schema?.safeParse({ tempFilePath: directory, extra: true }).success).toBe(false);
    expect(call.schema?.safeParse({ tempFilePath: 'relative' }).success).toBe(false);
    expect(call.schema?.safeParse({ tempFilePath: ` ${directory} ` }).success).toBe(false);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('returns a typed error when the screenshot command fails', async () => {
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockResolvedValue(
        Err({
          type: 'command-failed' as const,
          error: { code: 'capture-failed', message: 'capture failed', recoverable: false },
        }),
      ),
    });

    const result = await captureWindowScreenshot({ executor, signal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ type: 'window-screenshot-capture-error' });
    }
  });

  it.each([
    undefined,
    null,
    {},
    { tempFilePath: '' },
    { tempFilePath: '   ' },
    { tempFilePath: 42 },
    { tempFilePath: ` ${canonicalTempRoot}/capture ` },
    { tempFilePath: '/tmp/example', extra: true },
    { TempFilePath: canonicalTempRoot },
    { filePath: canonicalTempRoot },
  ])('rejects missing, blank, or wrong-shaped command results: %j', async (parsedResult) => {
    const result = await captureWindowScreenshot({
      executor: executorReturning(parsedResult),
      signal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ type: 'window-screenshot-capture-error' });
    }
  });

  it.each([
    () => canonicalTempRoot,
    () => `${canonicalTempRoot}-sibling/tableau-capture`,
    () => join(canonicalTempRoot, 'nested', '..', '..', 'escaped-tableau-capture'),
  ])('rejects the temp root, sibling-prefix paths, and traversal escapes', async (pathForCase) => {
    const returnedPath = pathForCase();
    const result = await captureWindowScreenshot({
      executor: executorReturning({ tempFilePath: returnedPath }),
      signal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).not.toContain(returnedPath);
  });

  it('rejects a returned directory symlink without removing its target', async () => {
    const target = commandDirectory('target');
    writeFileSync(join(target, 'ScreenShot_1.png'), png(20, 10));
    const link = join(canonicalTempRoot, `tableau-capture-link-${process.pid}-${Date.now()}`);
    cleanupRoots.push(link);
    symlinkSync(target, link, 'dir');

    const result = await captureWindowScreenshot({
      executor: executorReturning({ tempFilePath: link }),
      signal,
    });

    expect(result.isErr()).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(target, 'ScreenShot_1.png')).isFile()).toBe(true);
  });

  it('rejects a matching child symlink and does not remove its target', async () => {
    const directory = commandDirectory();
    const target = join(canonicalTempRoot, `tableau-secret-${process.pid}-${Date.now()}.png`);
    cleanupRoots.push(target);
    writeFileSync(target, png(50, 40));
    symlinkSync(target, join(directory, 'ScreenShot_1.png'));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(target).isFile()).toBe(true);
    expect(lstatSync(join(directory, 'ScreenShot_1.png')).isSymbolicLink()).toBe(true);
  });

  it('rejects a canonical child escape before reading or deleting it', async () => {
    const directory = commandDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    const outside = join(canonicalTempRoot, `tableau-outside-${process.pid}-${Date.now()}.png`);
    cleanupRoots.push(outside);
    writeFileSync(screenshot, png(10, 10));
    writeFileSync(outside, png(20, 20));
    const fileSystem: Partial<WindowScreenshotFileSystem> = {
      realpath: (path) => (path === screenshot ? outside : realpathSync(path)),
    };

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      fileSystem,
    );

    expect(result.isErr()).toBe(true);
    expect(lstatSync(screenshot).isFile()).toBe(true);
    expect(lstatSync(outside).isFile()).toBe(true);
  });

  it('ignores nonmatching files but fails closed rather than deleting them during cleanup', async () => {
    const directory = commandDirectory();
    const unrelated = join(directory, 'ScreenShot_1.png.bak');
    writeFileSync(unrelated, Buffer.from('do not inspect or delete'));
    writeFileSync(join(directory, 'ScreenShot_2.png'), png(30, 20));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(unrelated).isFile()).toBe(true);
    expect(() => lstatSync(join(directory, 'ScreenShot_2.png'))).toThrow();
  });

  it.each([
    ['invalid signature', Buffer.concat([Buffer.alloc(8), png(10, 10).subarray(8)])],
    ['truncated chunk', png(10, 10).subarray(0, -1)],
    [
      'malformed chunk length',
      (() => {
        const malformed = Buffer.from(png(10, 10));
        malformed.writeUInt32BE(0xffffffff, 8);
        return malformed;
      })(),
    ],
    ['missing IDAT', Buffer.concat([PNG_SIGNATURE, ihdr(10, 10), pngChunk('IEND')])],
    [
      'duplicate IHDR',
      Buffer.concat([
        PNG_SIGNATURE,
        ihdr(10, 10),
        ihdr(10, 10),
        pngChunk('IDAT', deflateSync(Buffer.from([0]))),
        pngChunk('IEND'),
      ]),
    ],
    ['missing IEND', png(10, 10).subarray(0, -12)],
    ['bytes after IEND', Buffer.concat([png(10, 10), Buffer.from('trailing')])],
    [
      'invalid chunk CRC',
      (() => {
        const invalidCrc = Buffer.from(png(10, 10));
        const idatTypeOffset = invalidCrc.indexOf(Buffer.from('IDAT'));
        invalidCrc[idatTypeOffset + 4] ^= 0xff;
        return invalidCrc;
      })(),
    ],
    [
      'illegal IHDR format fields',
      Buffer.concat([
        PNG_SIGNATURE,
        ihdr(10, 10, { bitDepth: 3, colorType: 6 }),
        pngChunk('IDAT', deflateSync(Buffer.from([0]))),
        pngChunk('IEND'),
      ]),
    ],
    [
      'empty IDAT',
      Buffer.concat([PNG_SIGNATURE, ihdr(10, 10), pngChunk('IDAT'), pngChunk('IEND')]),
    ],
    ['zero width', structurallyCompletePng(0, 10)],
    ['zero height', structurallyCompletePng(10, 0)],
    ['oversized dimensions', structurallyCompletePng(40_000, 10)],
    ['oversized pixel area', structurallyCompletePng(20_000, 20_000)],
  ])('rejects %s and cleans the safe command artifacts', async (_label, bytes) => {
    const directory = commandDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), bytes);

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('rejects a candidate over the byte cap before reading it', async () => {
    const directory = commandDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    writeFileSync(screenshot, png(10, 10));
    truncateSync(screenshot, MAX_WINDOW_SCREENSHOT_BYTES + 1);
    const read = vi.fn(() => Buffer.alloc(0));

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      { read },
    );

    expect(result.isErr()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('selects the largest pixel area rather than the largest compressed file', async () => {
    const directory = commandDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(200, 100));
    writeFileSync(join(directory, 'ScreenShot_2.png'), png(100, 100, true));

    const result = await captureFrom(directory);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toMatchObject({ width: 200, height: 100 });
    expect(() => lstatSync(directory)).toThrow();
  });

  it('rejects an over-count capture before reading any candidate', async () => {
    const directory = commandDirectory();
    for (let index = 0; index <= MAX_WINDOW_SCREENSHOT_CANDIDATES; index += 1) {
      writeFileSync(join(directory, `ScreenShot_${index}.png`), png(1, 1));
    }
    const read = vi.fn(() => {
      throw new Error('over-count candidates must not be read');
    });

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      { read },
    );

    expect(result.isErr()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(lstatSync(directory).isDirectory()).toBe(true);
  });

  it('rejects an aggregate byte budget breach before full reads and cleans validated files', async () => {
    const directory = commandDirectory();
    const candidateBytes = Math.floor(MAX_WINDOW_SCREENSHOT_AGGREGATE_BYTES / 3) + 1;
    for (let index = 0; index < 3; index += 1) {
      const path = join(directory, `ScreenShot_${index}.png`);
      writeFileSync(path, png(1, 1));
      truncateSync(path, candidateBytes);
    }
    const read = vi.fn(() => {
      throw new Error('aggregate-over-cap candidates must not be read');
    });

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      { read },
    );

    expect(result.isErr()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('does not invoke the command or filesystem for a pre-aborted capture', async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = executorReturning({ tempFilePath: '/not/reached' });
    const lstat = vi.fn(() => {
      throw new Error('filesystem must not be traversed');
    });

    const result = await captureWindowScreenshot(
      { executor, signal: controller.signal },
      { lstat },
    );

    expect(result.isErr()).toBe(true);
    expect(executor.executeCommand).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it('stops between candidate reads when aborted and cleans all preflight-validated files', async () => {
    const controller = new AbortController();
    const directory = commandDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(20, 10));
    writeFileSync(join(directory, 'ScreenShot_2.png'), png(10, 10));
    const read = vi.fn((fd: number) => {
      controller.abort();
      return readFileSync(fd);
    });

    const result = await captureWindowScreenshot(
      {
        executor: executorReturning({ tempFilePath: directory }),
        signal: controller.signal,
      },
      { read },
    );

    expect(result.isErr()).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('preflights and cleans command artifacts when the executor aborts before returning Ok', async () => {
    const controller = new AbortController();
    const directory = commandDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(10, 10));
    const executor = makeExecutorMock({
      executeCommand: vi.fn().mockImplementation(async () => {
        controller.abort();
        return Ok(completedCommand({ tempFilePath: directory }));
      }),
    });

    const result = await captureWindowScreenshot({ executor, signal: controller.signal });

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it.each(['file', 'directory'] as const)(
    'fails closed when stable %s identity is unavailable',
    async (zeroIdentityFor) => {
      const directory = commandDirectory();
      const screenshot = join(directory, 'ScreenShot_1.png');
      writeFileSync(screenshot, png(10, 10));
      const fileSystem: Partial<WindowScreenshotFileSystem> = {
        lstat: (path) => {
          const stats = lstatSync(path);
          return zeroIdentityFor === 'directory' ? withoutStableInode(stats) : stats;
        },
        stat: (path) => {
          const stats = lstatSync(path);
          return zeroIdentityFor === 'file' && path === screenshot
            ? withoutStableInode(stats)
            : stats;
        },
      };

      const result = await captureWindowScreenshot(
        { executor: executorReturning({ tempFilePath: directory }), signal },
        fileSystem,
      );

      expect(result.isErr()).toBe(true);
      expect(lstatSync(screenshot).isFile()).toBe(true);
    },
  );

  it('fails closed on equal largest pixel areas and cleans all safe candidates', async () => {
    const directory = commandDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(200, 100));
    writeFileSync(join(directory, 'ScreenShot_2.png'), png(100, 200));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('fails safely when a candidate vanishes between listing and inspection', async () => {
    const directory = commandDirectory();
    const screenshot = join(directory, 'ScreenShot_7.png');
    writeFileSync(screenshot, png(10, 10));
    let vanished = false;
    const fileSystem: Partial<WindowScreenshotFileSystem> = {
      lstat: (path) => {
        if (!vanished && basename(path) === 'ScreenShot_7.png') {
          vanished = true;
          unlinkSync(path);
          throw new Error('ENOENT at /secret/vanished.png');
        }
        return lstatSync(path);
      },
    };

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      fileSystem,
    );

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('fails safely on a permission error, redacts paths, and cleans validated candidates', async () => {
    const directory = commandDirectory('TOP-SECRET');
    const screenshot = join(directory, 'ScreenShot_9.png');
    writeFileSync(screenshot, png(10, 10));
    const fileSystem: Partial<WindowScreenshotFileSystem> = {
      open: () => {
        throw new Error(`EACCES: cannot open ${screenshot}`);
      },
    };

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      fileSystem,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).not.toContain('TOP-SECRET');
      expect(result.error.message).not.toContain('ScreenShot_9.png');
    }
    expect(() => lstatSync(directory)).toThrow();
  });

  it('does not delete a file that replaces the validated screenshot before cleanup', async () => {
    const directory = commandDirectory();
    const screenshot = join(directory, 'ScreenShot_11.png');
    writeFileSync(screenshot, png(10, 10));
    const replacement = Buffer.from('replacement must survive');
    let fstatCalls = 0;
    const fileSystem: Partial<WindowScreenshotFileSystem> = {
      fstat: (fd) => {
        const stats = fstatSync(fd);
        fstatCalls += 1;
        if (fstatCalls === 2) {
          unlinkSync(screenshot);
          writeFileSync(screenshot, replacement);
        }
        return stats;
      },
    };

    const result = await captureWindowScreenshot(
      { executor: executorReturning({ tempFilePath: directory }), signal },
      fileSystem,
    );

    expect(result.isErr()).toBe(true);
    expect(lstatSync(screenshot).size).toBe(replacement.byteLength);
  });

  it('rejects a matching child directory without recursively deleting it', async () => {
    const directory = commandDirectory();
    const nested = join(directory, 'ScreenShot_1.png');
    mkdirSync(nested);
    writeFileSync(join(nested, 'keep.txt'), Buffer.from('keep'));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(join(nested, 'keep.txt')).isFile()).toBe(true);
  });
});
