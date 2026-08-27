import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmdirSync,
  type Stats,
  statSync,
  unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { Err, Ok, type Result } from 'ts-results-es';
import { crc32 as zlibCrc32 } from 'zlib';
import { z } from 'zod';

import { McpToolError } from '../../errors/mcpToolError.js';
import type { WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';

export const MAX_WINDOW_SCREENSHOT_BYTES = 32 * 1024 * 1024;
export const MAX_WINDOW_SCREENSHOT_AGGREGATE_BYTES = 64 * 1024 * 1024;
export const MAX_WINDOW_SCREENSHOT_CANDIDATES = 16;
const MAX_WINDOW_SCREENSHOT_DIMENSION = 32_768;
const MAX_WINDOW_SCREENSHOT_PIXELS = 100_000_000;
const SCREENSHOT_NAME = /^ScreenShot_\d+\.png$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const screenshotCommandResultSchema = z
  .object({
    tempFilePath: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0 && isAbsolute(value)),
  })
  .strict();

export interface WindowScreenshotFileSystem {
  lstat(path: string): Stats;
  realpath(path: string): string;
  stat(path: string): Stats;
  readdir(path: string): string[];
  open(path: string, flags: number): number;
  fstat(fd: number): Stats;
  read(fd: number, maxBytes: number): Buffer;
  close(fd: number): void;
  unlink(path: string): void;
  rmdir(path: string): void;
}

const DEFAULT_FILE_SYSTEM: WindowScreenshotFileSystem = {
  lstat: lstatSync,
  realpath: realpathSync,
  stat: statSync,
  readdir: (path) => readdirSync(path),
  open: openSync,
  fstat: fstatSync,
  read: (fd, maxBytes) => {
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(fd, bytes, offset, bytes.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    return bytes.subarray(0, offset);
  },
  close: closeSync,
  unlink: unlinkSync,
  rmdir: rmdirSync,
};

export interface WindowScreenshotCapture {
  bytes: Buffer;
  width: number;
  height: number;
}

export class WindowScreenshotCaptureError extends McpToolError {
  constructor(message: string) {
    super({ type: 'window-screenshot-capture-error', message, statusCode: 500 });
  }
}

interface Candidate extends WindowScreenshotCapture {
  area: number;
}

interface ValidatedPath {
  path: string;
  canonicalPath: string;
  stats: Stats;
}

function failure(message: string): Err<WindowScreenshotCaptureError> {
  return new WindowScreenshotCaptureError(message).toErr();
}

function isStrictlyBelow(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

function hasStableIdentity(stats: Stats): boolean {
  return stats.ino !== 0;
}

function hasMatchingIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireMatchingIdentity(left: Stats, right: Stats): void {
  if (!hasStableIdentity(left) || !hasStableIdentity(right)) {
    throw new Error('Stable file identity is unavailable.');
  }
  if (!hasMatchingIdentity(left, right)) {
    throw new Error('File identity changed.');
  }
}

function hasMatchingCleanupIdentity(expected: Stats, current: Stats): boolean {
  return (
    hasStableIdentity(expected) &&
    hasStableIdentity(current) &&
    hasMatchingIdentity(expected, current)
  );
}

function hasLegalIhdrFormat(data: Buffer): boolean {
  const bitDepth = data[8];
  const colorType = data[9];
  const legalBitDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return (
    legalBitDepths[colorType]?.includes(bitDepth) === true &&
    data[10] === 0 &&
    data[11] === 0 &&
    (data[12] === 0 || data[12] === 1)
  );
}

function parsePngHeader(bytes: Buffer): { width: number; height: number; area: number } {
  if (!bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG header.');
  }

  let offset = PNG_SIGNATURE.byteLength;
  let ihdrCount = 0;
  let idatCount = 0;
  let sawIend = false;
  let width = 0;
  let height = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) throw new Error('Truncated PNG chunk.');
    const length = bytes.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength) {
      throw new Error('Invalid PNG chunk length.');
    }
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const declaredCrc = bytes.readUInt32BE(dataEnd);
    if (zlibCrc32(bytes.subarray(offset + 4, dataEnd)) !== declaredCrc) {
      throw new Error('Invalid PNG chunk CRC.');
    }

    if (offset === PNG_SIGNATURE.byteLength && type !== 'IHDR') {
      throw new Error('PNG does not start with IHDR.');
    }
    if (type === 'IHDR') {
      ihdrCount += 1;
      if (ihdrCount !== 1 || length !== 13) throw new Error('Invalid PNG IHDR.');
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      if (!hasLegalIhdrFormat(bytes.subarray(dataStart, dataEnd))) {
        throw new Error('Invalid PNG IHDR format.');
      }
    } else if (type === 'IDAT') {
      if (ihdrCount !== 1 || sawIend || length === 0) {
        throw new Error('Invalid PNG IDAT ordering.');
      }
      idatCount += 1;
    } else if (type === 'IEND') {
      if (length !== 0 || ihdrCount !== 1 || idatCount === 0 || sawIend) {
        throw new Error('Invalid PNG IEND.');
      }
      sawIend = true;
      if (chunkEnd !== bytes.byteLength) throw new Error('PNG has bytes after IEND.');
    }
    offset = chunkEnd;
  }

  if (ihdrCount !== 1 || idatCount === 0 || !sawIend) {
    throw new Error('PNG is missing required chunks.');
  }
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_WINDOW_SCREENSHOT_DIMENSION ||
    height > MAX_WINDOW_SCREENSHOT_DIMENSION
  ) {
    throw new Error('PNG dimensions are outside the supported bounds.');
  }

  const area = width * height;
  if (!Number.isSafeInteger(area) || area > MAX_WINDOW_SCREENSHOT_PIXELS) {
    throw new Error('PNG pixel area is outside the supported bounds.');
  }
  return { width, height, area };
}

function inspectCandidate(
  path: string,
  canonicalDirectory: string,
  fileSystem: WindowScreenshotFileSystem,
): ValidatedPath {
  const listed = fileSystem.lstat(path);
  if (listed.isSymbolicLink() || !listed.isFile()) {
    throw new Error('Screenshot candidate is not a direct regular file.');
  }

  const canonicalPath = fileSystem.realpath(path);
  if (dirname(canonicalPath) !== canonicalDirectory) {
    throw new Error('Screenshot candidate escaped its command directory.');
  }
  const current = fileSystem.stat(canonicalPath);
  if (!current.isFile()) throw new Error('Screenshot candidate is not a regular file.');
  requireMatchingIdentity(listed, current);
  return { path, canonicalPath, stats: current };
}

function readCandidate(
  validatedPath: ValidatedPath,
  canonicalDirectory: string,
  fileSystem: WindowScreenshotFileSystem,
): Candidate {
  if (validatedPath.stats.size < 57 || validatedPath.stats.size > MAX_WINDOW_SCREENSHOT_BYTES) {
    throw new Error('Screenshot candidate byte length is outside the supported bounds.');
  }

  let fd: number | null = null;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    fd = fileSystem.open(validatedPath.path, constants.O_RDONLY | noFollow);
    const opened = fileSystem.fstat(fd);
    if (!opened.isFile() || opened.size < 57 || opened.size > MAX_WINDOW_SCREENSHOT_BYTES) {
      throw new Error('Opened screenshot is outside the supported bounds.');
    }
    requireMatchingIdentity(validatedPath.stats, opened);
    validatedPath.stats = opened;

    const canonicalPathAfterOpen = fileSystem.realpath(validatedPath.path);
    if (
      canonicalPathAfterOpen !== validatedPath.canonicalPath ||
      dirname(canonicalPathAfterOpen) !== canonicalDirectory
    ) {
      throw new Error('Screenshot candidate changed after open.');
    }
    const currentAfterOpen = fileSystem.stat(canonicalPathAfterOpen);
    if (!currentAfterOpen.isFile()) throw new Error('Opened screenshot is not a regular file.');
    requireMatchingIdentity(opened, currentAfterOpen);
    if (currentAfterOpen.size !== opened.size) {
      throw new Error('Screenshot candidate changed size after open.');
    }

    const bytes = fileSystem.read(fd, opened.size);
    if (bytes.byteLength !== opened.size || bytes.byteLength > MAX_WINDOW_SCREENSHOT_BYTES) {
      throw new Error('Screenshot candidate changed while being read.');
    }
    const afterRead = fileSystem.fstat(fd);
    requireMatchingIdentity(opened, afterRead);
    if (afterRead.size !== opened.size) throw new Error('Screenshot candidate changed after read.');

    return { bytes, ...parsePngHeader(bytes) };
  } finally {
    if (fd !== null) {
      try {
        fileSystem.close(fd);
      } catch {
        // A close failure cannot make untrusted bytes safe.
      }
    }
  }
}

function cleanCommandArtifacts(
  canonicalDirectory: string,
  directoryStats: Stats,
  validatedPaths: ValidatedPath[],
  fileSystem: WindowScreenshotFileSystem,
): boolean {
  let clean = true;
  for (const validated of validatedPaths) {
    try {
      const current = fileSystem.lstat(validated.path);
      if (current.isSymbolicLink() || !current.isFile()) {
        clean = false;
        continue;
      }
      const canonicalPath = fileSystem.realpath(validated.path);
      const canonicalStats = fileSystem.stat(canonicalPath);
      if (
        canonicalPath !== validated.canonicalPath ||
        dirname(canonicalPath) !== canonicalDirectory ||
        !canonicalStats.isFile() ||
        !hasMatchingCleanupIdentity(validated.stats, canonicalStats)
      ) {
        clean = false;
        continue;
      }
      fileSystem.unlink(validated.path);
    } catch {
      clean = false;
    }
  }
  if (!clean) return false;
  try {
    const currentDirectory = fileSystem.lstat(canonicalDirectory);
    const currentCanonicalDirectory = fileSystem.realpath(canonicalDirectory);
    const currentCanonicalStats = fileSystem.stat(currentCanonicalDirectory);
    if (
      currentDirectory.isSymbolicLink() ||
      !currentDirectory.isDirectory() ||
      currentCanonicalDirectory !== canonicalDirectory ||
      !currentCanonicalStats.isDirectory() ||
      !hasMatchingCleanupIdentity(directoryStats, currentCanonicalStats)
    ) {
      return false;
    }
    fileSystem.rmdir(canonicalDirectory);
    return true;
  } catch {
    return false;
  }
}

export async function captureWindowScreenshot(
  { executor, signal }: WithExecutorAndAbortSignal,
  fileSystemOverrides: Partial<WindowScreenshotFileSystem> = {},
): Promise<Result<WindowScreenshotCapture, McpToolError>> {
  const fileSystem = { ...DEFAULT_FILE_SYSTEM, ...fileSystemOverrides };
  if (signal.aborted) {
    return failure('Tableau Desktop window capture was cancelled.');
  }
  const commandResult = await executor.executeCommand({
    namespace: 'tabui',
    command: 'take-all-screenshots',
    args: { HideMouse: true },
    schema: screenshotCommandResultSchema,
    signal,
  });
  if (commandResult.isErr()) {
    return failure('Tableau Desktop could not capture the visible window.');
  }

  const parsedResult = screenshotCommandResultSchema.safeParse(commandResult.value.parsedResult);
  if (!parsedResult.success) {
    return failure('Tableau Desktop returned an invalid screenshot result.');
  }
  const cancelledAfterCommand: boolean = Boolean(signal.aborted);

  let canonicalDirectory: string | undefined;
  let directoryStats: Stats | undefined;
  const validatedPaths: ValidatedPath[] = [];
  let outcome: Result<WindowScreenshotCapture, McpToolError>;
  try {
    const returnedDirectory = resolve(parsedResult.data.tempFilePath);
    const canonicalTempRoot = fileSystem.realpath(tmpdir());
    const returnedStats = fileSystem.lstat(returnedDirectory);
    if (returnedStats.isSymbolicLink() || !returnedStats.isDirectory()) {
      throw new Error('Returned screenshot path is not a direct directory.');
    }

    canonicalDirectory = fileSystem.realpath(returnedDirectory);
    if (!isStrictlyBelow(canonicalTempRoot, canonicalDirectory)) {
      canonicalDirectory = undefined;
      throw new Error('Returned screenshot directory escaped the OS temp root.');
    }
    const canonicalStats = fileSystem.stat(canonicalDirectory);
    if (!canonicalStats.isDirectory())
      throw new Error('Returned screenshot path is not a directory.');
    requireMatchingIdentity(returnedStats, canonicalStats);
    directoryStats = canonicalStats;
    if (fileSystem.realpath(returnedDirectory) !== canonicalDirectory) {
      throw new Error('Returned screenshot directory changed during validation.');
    }

    const names = fileSystem
      .readdir(canonicalDirectory)
      .filter((name) => SCREENSHOT_NAME.test(name));
    if (names.length === 0) {
      outcome = failure('Tableau Desktop did not produce a screenshot.');
    } else if (names.length > MAX_WINDOW_SCREENSHOT_CANDIDATES) {
      outcome = failure('Tableau Desktop produced too many screenshot artifacts.');
    } else {
      names.sort((left, right) => left.localeCompare(right));
      let invalidCandidate = false;
      let cancelled: boolean = cancelledAfterCommand;
      let aggregateBytes = 0;
      for (const name of names) {
        if (signal.aborted && !cancelledAfterCommand) {
          cancelled = true;
          break;
        }
        try {
          const validated = inspectCandidate(
            resolve(canonicalDirectory, name),
            canonicalDirectory,
            fileSystem,
          );
          validatedPaths.push(validated);
          if (validated.stats.size < 57 || validated.stats.size > MAX_WINDOW_SCREENSHOT_BYTES) {
            invalidCandidate = true;
          }
          aggregateBytes += validated.stats.size;
          if (
            !Number.isSafeInteger(aggregateBytes) ||
            aggregateBytes > MAX_WINDOW_SCREENSHOT_AGGREGATE_BYTES
          ) {
            invalidCandidate = true;
          }
        } catch {
          invalidCandidate = true;
        }
      }

      let selected: Candidate | undefined;
      let selectedIsUnique = true;
      if (!invalidCandidate && !cancelled) {
        for (const validated of validatedPaths) {
          if (signal.aborted) {
            cancelled = true;
            break;
          }
          try {
            const candidate = readCandidate(validated, canonicalDirectory, fileSystem);
            if (selected === undefined || candidate.area > selected.area) {
              selected = candidate;
              selectedIsUnique = true;
            } else if (candidate.area === selected.area) {
              selectedIsUnique = false;
            }
          } catch {
            invalidCandidate = true;
          }
        }
      }

      if (cancelled) {
        outcome = failure('Tableau Desktop window capture was cancelled.');
      } else if (invalidCandidate || selected === undefined) {
        outcome = failure('Tableau Desktop produced an invalid screenshot artifact.');
      } else if (!selectedIsUnique) {
        outcome = failure('Tableau Desktop produced ambiguous screenshot artifacts.');
      } else {
        outcome = Ok({ bytes: selected.bytes, width: selected.width, height: selected.height });
      }
    }
  } catch {
    outcome = failure('Tableau Desktop returned an unsafe screenshot artifact.');
  }

  if (
    canonicalDirectory !== undefined &&
    directoryStats !== undefined &&
    !cleanCommandArtifacts(canonicalDirectory, directoryStats, validatedPaths, fileSystem)
  ) {
    return failure('Tableau Desktop screenshot artifacts could not be safely removed.');
  }
  return outcome;
}
