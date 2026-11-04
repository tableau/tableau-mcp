import {
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

import type { FileSystem } from '../../utils/fileSystem.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import {
  captureWindowScreenshot,
  MAX_WINDOW_SCREENSHOT_AGGREGATE_BYTES,
  MAX_WINDOW_SCREENSHOT_BYTES,
  MAX_WINDOW_SCREENSHOT_CANDIDATES,
  WindowScreenshotCaptureError,
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

function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
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

function pngMetadata(width: number, height: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height), pngChunk('IDAT'), pngChunk('IEND')]);
}

function withoutStableInode(stats: Stats): Stats {
  return withInode(stats, 0);
}

function withInode(stats: Stats, ino: number): Stats {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats) as Stats;
  Object.defineProperty(copy, 'ino', { value: ino, configurable: true });
  return copy;
}

function withSize(stats: Stats, size: number): Stats {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats) as Stats;
  Object.defineProperty(copy, 'size', { value: size, configurable: true });
  return copy;
}

function expectLocalCaptureError(error: unknown): asserts error is WindowScreenshotCaptureError {
  expect(error).toBeInstanceOf(WindowScreenshotCaptureError);
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

  function captureDirectory(label = 'capture'): string {
    const directory = mkdtempSync(join(canonicalTempRoot, `tableau-${label}-`));
    cleanupRoots.push(directory);
    return directory;
  }

  function listedScreenshots(outputPath: string): string[] {
    if (!existsSync(outputPath)) return [];
    return readdirSync(outputPath)
      .filter((name) => /^ScreenShot_\d+\.png$/.test(name))
      .map((name) => join(outputPath, name));
  }

  function routeExecutor(
    captureAppScreenshot: ExternalApiToolExecutor['captureAppScreenshot'] = async (outputPath) =>
      Ok({ filePaths: listedScreenshots(outputPath) }),
  ): ExternalApiToolExecutor {
    return makeExecutorMock({
      desktopInstanceId: 'inst-capture',
      captureAppScreenshot: vi.fn(captureAppScreenshot),
    });
  }

  function trackedMkdtemp(): ReturnType<typeof vi.fn<FileSystem['mkdtemp']>> {
    return vi.fn<FileSystem['mkdtemp']>((prefix) => {
      const directory = mkdtempSync(prefix);
      cleanupRoots.push(directory);
      return directory;
    });
  }

  function captureFrom(
    directory: string,
    fileSystem: Partial<FileSystem> = {},
    captureSignal: AbortSignal = signal,
  ): ReturnType<typeof captureWindowScreenshot> {
    return captureWindowScreenshot(
      { executor: routeExecutor(), signal: captureSignal },
      { mkdtemp: () => directory, ...fileSystem },
    );
  }

  it('selects the largest returned screenshot and removes the requested directory', async () => {
    const mkdtemp = trackedMkdtemp();
    const expected = png(1200, 800);
    const executor = routeExecutor(async (outputPath) => {
      writeFileSync(join(outputPath, 'ScreenShot_1.png'), png(300, 200, true));
      writeFileSync(join(outputPath, 'ScreenShot_2.png'), expected);
      return Ok({ filePaths: listedScreenshots(outputPath) });
    });

    const result = await captureWindowScreenshot({ executor, signal }, { mkdtemp });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.bytes.equals(expected)).toBe(true);
      expect(result.value).toMatchObject({ width: 1200, height: 800 });
    }
    expect(mkdtemp).toHaveBeenCalledExactlyOnceWith(
      join(canonicalTempRoot, 'desktop-window-capture-'),
    );
    const directory = mkdtemp.mock.results[0].value as string;
    expect(executor.captureAppScreenshot).toHaveBeenCalledExactlyOnceWith(directory, signal);
    expect(() => lstatSync(directory)).toThrow();
  });

  it.each([
    [
      'outside the requested directory',
      (directory: string) => join(`${directory}-other`, 'ScreenShot_1.png'),
    ],
    [
      'not among the listed screenshots',
      (directory: string) => join(directory, 'ScreenShot_9.png'),
    ],
  ])(
    'fails as an unsafe artifact when a returned path is %s and cleans up',
    async (_case, pathFor) => {
      const mkdtemp = trackedMkdtemp();
      const executor = routeExecutor(async (outputPath) =>
        Ok({ filePaths: [pathFor(outputPath)] }),
      );

      const result = await captureWindowScreenshot({ executor, signal }, { mkdtemp });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expectLocalCaptureError(result.error);
        expect(result.error.message).toBe(
          'Tableau Desktop returned an unsafe screenshot artifact.',
        );
      }
      expect(() => lstatSync(mkdtemp.mock.results[0].value as string)).toThrow();
    },
  );

  it('returns the route error unchanged and removes the requested directory', async () => {
    const mkdtemp = trackedMkdtemp();
    const routeError = {
      type: 'command-failed' as const,
      error: {
        code: 'capture-failed',
        message: 'capture failed',
        recoverable: false,
        'tableau-error-code': '0xA11CE',
      },
    };
    const executor = routeExecutor(async () => Err(routeError));

    const result = await captureWindowScreenshot({ executor, signal }, { mkdtemp });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBe(routeError);
    expect(executor.captureAppScreenshot).toHaveBeenCalledOnce();
    expect(() => lstatSync(mkdtemp.mock.results[0].value as string)).toThrow();
  });

  it('fails closed when the requested directory cannot be safely removed after a route error', async () => {
    const directory = captureDirectory();
    writeFileSync(join(directory, 'keep.txt'), Buffer.from('keep'));
    const executor = routeExecutor(async () =>
      Err({ type: 'command-timed-out' as const, error: 'Command timed out' }),
    );

    const result = await captureWindowScreenshot(
      { executor, signal },
      { mkdtemp: () => directory },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).toBe(
        'Tableau Desktop screenshot artifacts could not be safely removed.',
      );
    }
    expect(lstatSync(join(directory, 'keep.txt')).isFile()).toBe(true);
  });

  it('returns a capture error without calling the route when the directory cannot be created', async () => {
    const mkdtemp = vi.fn<FileSystem['mkdtemp']>(() => {
      throw new Error('EACCES');
    });
    const executor = routeExecutor();

    const result = await captureWindowScreenshot({ executor, signal }, { mkdtemp });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).toBe(
        'A temporary directory for the Tableau Desktop screenshot could not be created.',
      );
    }
    expect(executor.captureAppScreenshot).not.toHaveBeenCalled();
  });

  it('returns the exact no-screenshot error and removes an empty requested directory', async () => {
    const directory = captureDirectory();

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).toBe('Tableau Desktop did not produce a screenshot.');
    }
    expect(() => lstatSync(directory)).toThrow();
  });

  it.each([
    () => canonicalTempRoot,
    () => `${canonicalTempRoot}-sibling/tableau-capture`,
    () => join(canonicalTempRoot, 'nested', '..', '..', 'escaped-tableau-capture'),
  ])('rejects the temp root, sibling-prefix paths, and traversal escapes', async (pathForCase) => {
    const returnedPath = pathForCase();
    const result = await captureFrom(returnedPath);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).not.toContain(returnedPath);
    }
  });

  it('rejects a returned directory symlink without removing its target', async () => {
    const target = captureDirectory('target');
    writeFileSync(join(target, 'ScreenShot_1.png'), png(20, 10));
    const link = join(canonicalTempRoot, `tableau-capture-link-${process.pid}-${Date.now()}`);
    cleanupRoots.push(link);
    symlinkSync(target, link, 'dir');

    const result = await captureFrom(link);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(target, 'ScreenShot_1.png')).isFile()).toBe(true);
  });

  it('rejects a matching child symlink and does not remove its target', async () => {
    const directory = captureDirectory();
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
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    const outside = join(canonicalTempRoot, `tableau-outside-${process.pid}-${Date.now()}.png`);
    cleanupRoots.push(outside);
    writeFileSync(screenshot, png(10, 10));
    writeFileSync(outside, png(20, 20));
    const fileSystem: Partial<FileSystem> = {
      realpath: (path) => (path === screenshot ? outside : realpathSync(path)),
    };

    const result = await captureFrom(directory, fileSystem);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(screenshot).isFile()).toBe(true);
    expect(lstatSync(outside).isFile()).toBe(true);
  });

  it('ignores nonmatching files but fails closed rather than deleting them during cleanup', async () => {
    const directory = captureDirectory();
    const unrelated = join(directory, 'ScreenShot_1.png.bak');
    writeFileSync(unrelated, Buffer.from('do not inspect or delete'));
    const screenshot = join(directory, 'ScreenShot_2.png');
    writeFileSync(screenshot, png(30, 20));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(unrelated).isFile()).toBe(true);
    expect(() => lstatSync(screenshot)).toThrow();
  });

  it.each([
    ['invalid signature', Buffer.concat([Buffer.alloc(8), png(10, 10).subarray(8)])],
    ['truncated metadata', PNG_SIGNATURE],
    ['truncated after 57 bytes', png(10, 10).subarray(0, 57)],
    ['missing IEND footer', png(10, 10).subarray(0, -12)],
    ['missing final byte', png(10, 10).subarray(0, -1)],
    [
      'invalid metadata',
      Buffer.concat([
        PNG_SIGNATURE,
        Buffer.alloc(4),
        Buffer.from('NOPE'),
        Buffer.alloc(29),
        pngChunk('IEND'),
      ]),
    ],
    ['zero width', pngMetadata(0, 10)],
    ['zero height', pngMetadata(10, 0)],
    ['oversized dimensions', pngMetadata(40_000, 10)],
    ['oversized pixel area', pngMetadata(20_000, 20_000)],
  ])('rejects %s and cleans the safe screenshot artifacts', async (_label, bytes) => {
    const directory = captureDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), bytes);

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('rejects a candidate over the byte cap before reading it', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    writeFileSync(screenshot, png(10, 10));
    truncateSync(screenshot, MAX_WINDOW_SCREENSHOT_BYTES + 1);
    const read = vi.fn(() => Buffer.alloc(0));

    const result = await captureFrom(directory, { read });

    expect(result.isErr()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('permits one screenshot at the byte cap to reach the bounded read', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    writeFileSync(screenshot, png(1, 1));
    truncateSync(screenshot, MAX_WINDOW_SCREENSHOT_BYTES);
    const read = vi.fn((_fd: number, maxBytes: number) => Buffer.alloc(maxBytes));

    const result = await captureFrom(directory, { read });

    expect(result.isErr()).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(expect.any(Number), MAX_WINDOW_SCREENSHOT_BYTES);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('rejects an over-count capture before reading any candidate', async () => {
    const directory = captureDirectory();
    for (let index = 0; index <= MAX_WINDOW_SCREENSHOT_CANDIDATES; index += 1) {
      writeFileSync(join(directory, `ScreenShot_${index}.png`), png(1, 1));
    }
    const open = vi.fn(() => {
      throw new Error('over-count candidates must not be opened');
    });
    const read = vi.fn(() => {
      throw new Error('over-count candidates must not be read');
    });

    const result = await captureFrom(directory, { open, read });

    expect(result.isErr()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('removes only validated over-count candidates while preserving foreign and symlink entries', async () => {
    const directory = captureDirectory();
    const realCandidates = Array.from({ length: MAX_WINDOW_SCREENSHOT_CANDIDATES }, (_, index) =>
      join(directory, `ScreenShot_${index}.png`),
    );
    for (const candidate of realCandidates) writeFileSync(candidate, png(1, 1));
    const foreign = join(directory, 'keep.txt');
    writeFileSync(foreign, Buffer.from('keep'));
    const target = join(canonicalTempRoot, `tableau-target-${process.pid}-${Date.now()}.png`);
    cleanupRoots.push(target);
    writeFileSync(target, png(2, 2));
    const link = join(directory, `ScreenShot_${MAX_WINDOW_SCREENSHOT_CANDIDATES}.png`);
    symlinkSync(target, link);
    const open = vi.fn(() => {
      throw new Error('over-count candidates must not be opened');
    });

    const result = await captureFrom(directory, { open });

    expect(result.isErr()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    for (const candidate of realCandidates) expect(() => lstatSync(candidate)).toThrow();
    expect(lstatSync(foreign).isFile()).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(lstatSync(target).isFile()).toBe(true);
  });

  it('rejects an aggregate byte budget breach before full reads and cleans validated files', async () => {
    const directory = captureDirectory();
    const candidateBytes = Math.floor(MAX_WINDOW_SCREENSHOT_AGGREGATE_BYTES / 3) + 1;
    for (let index = 0; index < 3; index += 1) {
      const path = join(directory, `ScreenShot_${index}.png`);
      writeFileSync(path, png(1, 1));
      truncateSync(path, candidateBytes);
    }
    const read = vi.fn(() => {
      throw new Error('aggregate-over-cap candidates must not be read');
    });

    const result = await captureFrom(directory, { read });

    expect(result.isErr()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('does not invoke the route or filesystem for a pre-aborted capture', async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = routeExecutor();
    const mkdtemp = vi.fn<FileSystem['mkdtemp']>(() => {
      throw new Error('a directory must not be created');
    });
    const lstat = vi.fn(() => {
      throw new Error('filesystem must not be traversed');
    });

    const result = await captureWindowScreenshot(
      { executor, signal: controller.signal },
      { mkdtemp, lstat },
    );

    expect(result.isErr()).toBe(true);
    expect(executor.captureAppScreenshot).not.toHaveBeenCalled();
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
  });

  it('keeps validating later candidates after cancellation during metadata gathering', async () => {
    const controller = new AbortController();
    const directory = captureDirectory();
    const first = join(directory, 'ScreenShot_1.png');
    const second = join(directory, 'ScreenShot_2.png');
    writeFileSync(first, png(20, 10));
    writeFileSync(second, png(10, 10));
    const stat = vi.fn((path: string) => {
      const stats = lstatSync(path);
      if (path === first) controller.abort();
      return stats;
    });
    const read = vi.fn(() => {
      throw new Error('cancelled candidates must not be read');
    });

    const result = await captureFrom(directory, { stat, read }, controller.signal);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).toBe('Tableau Desktop window capture was cancelled.');
    }
    expect(stat).toHaveBeenCalledWith(second);
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('stops between candidate reads when aborted and cleans all preflight-validated files', async () => {
    const controller = new AbortController();
    const directory = captureDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(20, 10));
    writeFileSync(join(directory, 'ScreenShot_2.png'), png(10, 10));
    const read = vi.fn((fd: number) => {
      controller.abort();
      return readFileSync(fd);
    });

    const result = await captureFrom(directory, { read }, controller.signal);

    expect(result.isErr()).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('returns cancellation when aborted during the only candidate read and cleans the file', async () => {
    const controller = new AbortController();
    const directory = captureDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(20, 10));
    const read = vi.fn((fd: number) => {
      controller.abort();
      return readFileSync(fd);
    });

    const result = await captureFrom(directory, { read }, controller.signal);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).toBe('Tableau Desktop window capture was cancelled.');
    }
    expect(read).toHaveBeenCalledOnce();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('preflights and cleans screenshot artifacts when the executor aborts before returning Ok', async () => {
    const controller = new AbortController();
    const directory = captureDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(10, 10));
    const executor = routeExecutor(async (outputPath) => {
      controller.abort();
      return Ok({ filePaths: listedScreenshots(outputPath) });
    });

    const result = await captureWindowScreenshot(
      { executor, signal: controller.signal },
      { mkdtemp: () => directory },
    );

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it.each(['file', 'directory'] as const)(
    'fails closed when stable %s identity is unavailable',
    async (zeroIdentityFor) => {
      const directory = captureDirectory();
      const screenshot = join(directory, 'ScreenShot_1.png');
      writeFileSync(screenshot, png(10, 10));
      const fileSystem: Partial<FileSystem> = {
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

      const result = await captureFrom(directory, fileSystem);

      expect(result.isErr()).toBe(true);
      expect(lstatSync(screenshot).isFile()).toBe(true);
    },
  );

  it('rejects an opened file whose identity differs from the inspected candidate', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    writeFileSync(screenshot, png(10, 10));
    const read = vi.fn(() => {
      throw new Error('an identity-mismatched file must not be read');
    });
    const fstat = vi.fn((fd: number) => {
      const stats = fstatSync(fd);
      return withInode(stats, stats.ino + 1);
    });

    const result = await captureFrom(directory, { fstat, read });

    expect(result.isErr()).toBe(true);
    expect(fstat).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('rejects same-identity growth between inspection and open before reading', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    writeFileSync(screenshot, png(10, 10));
    const initialSize = lstatSync(screenshot).size;
    let screenshotStatCalls = 0;
    const stat = vi.fn((path: string) => {
      const stats = lstatSync(path);
      if (path !== screenshot) return stats;
      screenshotStatCalls += 1;
      return screenshotStatCalls === 1 ? stats : withSize(stats, initialSize + 1);
    });
    const fstat = vi.fn((fd: number) => withSize(fstatSync(fd), initialSize + 1));
    const read = vi.fn(() => {
      throw new Error('a file that grew after the aggregate precheck must not be read');
    });

    const result = await captureFrom(directory, { stat, fstat, read });

    expect(result.isErr()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('rejects a file whose identity changes on the post-read fstat', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_1.png');
    writeFileSync(screenshot, png(10, 10));
    let fstatCalls = 0;
    const fstat = vi.fn((fd: number) => {
      const stats = fstatSync(fd);
      fstatCalls += 1;
      return fstatCalls === 2 ? withInode(stats, stats.ino + 1) : stats;
    });
    const read = vi.fn((fd: number) => readFileSync(fd));

    const result = await captureFrom(directory, { fstat, read });

    expect(result.isErr()).toBe(true);
    expect(fstat).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
    expect(() => lstatSync(directory)).toThrow();
  });

  it('fails closed on equal largest pixel areas and cleans all safe candidates', async () => {
    const directory = captureDirectory();
    writeFileSync(join(directory, 'ScreenShot_1.png'), png(200, 100));
    writeFileSync(join(directory, 'ScreenShot_2.png'), png(100, 200));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('fails safely when a candidate vanishes between listing and inspection', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_7.png');
    writeFileSync(screenshot, png(10, 10));
    let vanished = false;
    const fileSystem: Partial<FileSystem> = {
      lstat: (path) => {
        if (!vanished && basename(path) === 'ScreenShot_7.png') {
          vanished = true;
          unlinkSync(path);
          throw new Error('ENOENT at /secret/vanished.png');
        }
        return lstatSync(path);
      },
    };

    const result = await captureFrom(directory, fileSystem);

    expect(result.isErr()).toBe(true);
    expect(() => lstatSync(directory)).toThrow();
  });

  it('fails safely on a permission error, redacts paths, and cleans validated candidates', async () => {
    const directory = captureDirectory('TOP-SECRET');
    const screenshot = join(directory, 'ScreenShot_9.png');
    writeFileSync(screenshot, png(10, 10));
    const fileSystem: Partial<FileSystem> = {
      open: () => {
        throw new Error(`EACCES: cannot open ${screenshot}`);
      },
    };

    const result = await captureFrom(directory, fileSystem);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expectLocalCaptureError(result.error);
      expect(result.error.message).not.toContain('TOP-SECRET');
      expect(result.error.message).not.toContain('ScreenShot_9.png');
    }
    expect(() => lstatSync(directory)).toThrow();
  });

  it('does not delete a candidate when cleanup observes a different direct-path identity', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_10.png');
    const replacement = join(canonicalTempRoot, `tableau-replacement-${process.pid}-${Date.now()}`);
    cleanupRoots.push(replacement);
    writeFileSync(screenshot, png(10, 10));
    writeFileSync(replacement, Buffer.from('replacement identity'));
    let finishedReading = false;
    let fstatCalls = 0;
    const fileSystem: Partial<FileSystem> = {
      fstat: (fd) => {
        const stats = fstatSync(fd);
        fstatCalls += 1;
        if (fstatCalls === 2) finishedReading = true;
        return stats;
      },
      lstat: (path) =>
        path === screenshot && finishedReading ? lstatSync(replacement) : lstatSync(path),
    };

    const result = await captureFrom(directory, fileSystem);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(screenshot).isFile()).toBe(true);
  });

  it('does not delete a file that replaces the validated screenshot before cleanup', async () => {
    const directory = captureDirectory();
    const screenshot = join(directory, 'ScreenShot_11.png');
    writeFileSync(screenshot, png(10, 10));
    const replacement = Buffer.from('replacement must survive');
    let fstatCalls = 0;
    const fileSystem: Partial<FileSystem> = {
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

    const result = await captureFrom(directory, fileSystem);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(screenshot).size).toBe(replacement.byteLength);
  });

  it('rejects a matching child directory without recursively deleting it', async () => {
    const directory = captureDirectory();
    const nested = join(directory, 'ScreenShot_1.png');
    mkdirSync(nested);
    writeFileSync(join(nested, 'keep.txt'), Buffer.from('keep'));

    const result = await captureFrom(directory);

    expect(result.isErr()).toBe(true);
    expect(lstatSync(join(nested, 'keep.txt')).isFile()).toBe(true);
  });
});
