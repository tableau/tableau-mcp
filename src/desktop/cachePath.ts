import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve, sep } from 'path';

import { DesktopCache } from './cache.js';

export interface ContainedCacheReadOperations {
  open(path: string, flags: number): number;
  fstat(fd: number): Stats;
  realpath(path: string): string;
  stat(path: string): Stats;
  read(fd: number): Buffer;
  close(fd: number): void;
}

export interface ContainedCacheWriteOperations {
  noFollowFlag: number;
  open(path: string, flags: number, mode?: number): number;
  fstat(fd: number): Stats;
  realpath(path: string): string;
  stat(path: string): Stats;
  truncate(fd: number, length: number): void;
  write(fd: number, text: string): void;
  close(fd: number): void;
}

export const CONTAINED_CACHE_READ_ISSUE = {
  outsideCache: 'outside-cache',
  missing: 'missing',
  unsafeFile: 'unsafe-file',
  readError: 'read-error',
} as const;

export type ContainedCacheReadResult =
  | { ok: true; path: string; text: string }
  | {
      ok: false;
      issue: (typeof CONTAINED_CACHE_READ_ISSUE)[keyof typeof CONTAINED_CACHE_READ_ISSUE];
      error?: unknown;
    };

export const CONTAINED_CACHE_WRITE_ISSUE = {
  outsideCache: 'outside-cache',
  unsupportedNewPath: 'unsupported-new-path',
  unsafeFile: 'unsafe-file',
  writeError: 'write-error',
} as const;

export type ContainedCacheWriteResult =
  | { ok: true; path: string }
  | {
      ok: false;
      issue: (typeof CONTAINED_CACHE_WRITE_ISSUE)[keyof typeof CONTAINED_CACHE_WRITE_ISSUE];
      error?: unknown;
    };

const DEFAULT_CONTAINED_CACHE_READ_OPERATIONS: ContainedCacheReadOperations = {
  open: openSync,
  fstat: fstatSync,
  realpath: realpathSync,
  stat: statSync,
  read: (fd) => readFileSync(fd),
  close: closeSync,
};

const DEFAULT_CONTAINED_CACHE_WRITE_OPERATIONS: ContainedCacheWriteOperations = {
  noFollowFlag: typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0,
  open: openSync,
  fstat: fstatSync,
  realpath: realpathSync,
  stat: statSync,
  truncate: ftruncateSync,
  write: (fd, text) => writeFileSync(fd, text, 'utf-8'),
  close: closeSync,
};

export function getCacheDir(): string {
  return resolve(dirname(new DesktopCache().getCacheFilePath({ prefix: '_', id: '_' })));
}

// True only when absolutePath is the cache dir itself or a descendant of it.
// A raw startsWith(cacheDir) check is unsafe: a sibling like `<dir>-evil` or
// `<dir>XYZ.xml` shares the prefix and would escape containment.
export function isWithinCacheDir(absolutePath: string, cacheDir: string): boolean {
  return absolutePath === cacheDir || absolutePath.startsWith(cacheDir + sep);
}

function hasStableFileIdentity(stats: Stats): boolean {
  return stats.ino !== 0;
}

function hasMatchingFileIdentity(opened: Stats, current: Stats): boolean {
  return opened.dev === current.dev && opened.ino === current.ino;
}

function errnoCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function openFailure(error: unknown): ContainedCacheReadResult {
  const code = errnoCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { ok: false, issue: 'missing', error };
  }
  if (code === 'ELOOP') {
    return { ok: false, issue: 'unsafe-file', error };
  }
  return { ok: false, issue: 'read-error', error };
}

function verificationFailure(error: unknown): ContainedCacheReadResult {
  const code = errnoCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
    return { ok: false, issue: 'unsafe-file', error };
  }
  return { ok: false, issue: 'read-error', error };
}

/**
 * Read a regular cache file through the descriptor whose identity and containment were verified.
 * Callers may opt into this stricter boundary without changing the legacy local-cache behavior.
 */
export function readContainedCacheTextFile(
  path: string,
  operations: ContainedCacheReadOperations = DEFAULT_CONTAINED_CACHE_READ_OPERATIONS,
): ContainedCacheReadResult {
  const cacheDir = getCacheDir();
  const absolutePath = resolve(path);
  if (!isWithinCacheDir(absolutePath, cacheDir)) {
    return { ok: false, issue: 'outside-cache' };
  }

  let realCacheDir: string;
  try {
    realCacheDir = operations.realpath(cacheDir);
  } catch (error) {
    return { ok: false, issue: 'read-error', error };
  }

  let fd: number | null = null;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    try {
      fd = operations.open(absolutePath, constants.O_RDONLY | noFollow);
    } catch (error) {
      return openFailure(error);
    }

    let opened: Stats;
    try {
      opened = operations.fstat(fd);
    } catch (error) {
      return { ok: false, issue: 'read-error', error };
    }
    if (!opened.isFile()) {
      return { ok: false, issue: 'unsafe-file' };
    }

    let currentPathBefore: string;
    let current: Stats;
    let currentPathAfter: string;
    try {
      currentPathBefore = operations.realpath(absolutePath);
      if (!isWithinCacheDir(currentPathBefore, realCacheDir)) {
        return { ok: false, issue: 'unsafe-file' };
      }
      current = operations.stat(currentPathBefore);
      currentPathAfter = operations.realpath(absolutePath);
    } catch (error) {
      return verificationFailure(error);
    }

    if (
      currentPathAfter !== currentPathBefore ||
      !isWithinCacheDir(currentPathAfter, realCacheDir) ||
      !current.isFile()
    ) {
      return { ok: false, issue: 'unsafe-file' };
    }
    if (
      hasStableFileIdentity(opened) &&
      hasStableFileIdentity(current) &&
      !hasMatchingFileIdentity(opened, current)
    ) {
      return { ok: false, issue: 'unsafe-file' };
    }

    try {
      return { ok: true, path: absolutePath, text: operations.read(fd).toString('utf-8') };
    } catch (error) {
      return { ok: false, issue: 'read-error', error };
    }
  } finally {
    if (fd !== null) {
      try {
        operations.close(fd);
      } catch {
        // Closing cannot make an untrusted file safe to consume.
      }
    }
  }
}

/** Write only after the opened descriptor is proven to be a regular file inside the cache. */
export function writeContainedCacheTextFile(
  path: string,
  text: string,
  operations: ContainedCacheWriteOperations = DEFAULT_CONTAINED_CACHE_WRITE_OPERATIONS,
): ContainedCacheWriteResult {
  const cacheDir = getCacheDir();
  const absolutePath = resolve(path);
  if (!isWithinCacheDir(absolutePath, cacheDir)) {
    return { ok: false, issue: 'outside-cache' };
  }

  let realCacheDir: string;
  try {
    realCacheDir = operations.realpath(cacheDir);
  } catch (error) {
    return { ok: false, issue: 'write-error', error };
  }

  let fd: number | null = null;
  try {
    try {
      fd = operations.open(absolutePath, constants.O_RDWR | operations.noFollowFlag);
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') {
        return writeOpenFailure(error);
      }

      // DesktopCache emits direct children. Limiting creation to that shape avoids
      // claiming nested parent traversal is race-safe without an openat-style API.
      if (dirname(absolutePath) !== cacheDir) {
        return { ok: false, issue: 'unsupported-new-path' };
      }
      let realParent: string;
      try {
        realParent = operations.realpath(dirname(absolutePath));
      } catch (parentError) {
        return { ok: false, issue: 'write-error', error: parentError };
      }
      if (realParent !== realCacheDir) {
        return { ok: false, issue: 'unsafe-file' };
      }
      try {
        fd = operations.open(
          absolutePath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | operations.noFollowFlag,
          0o600,
        );
      } catch (createError) {
        return writeOpenFailure(createError);
      }
    }

    let opened: Stats;
    try {
      opened = operations.fstat(fd);
    } catch (error) {
      return { ok: false, issue: 'write-error', error };
    }
    if (!opened.isFile()) {
      return { ok: false, issue: 'unsafe-file' };
    }

    let currentPathBefore: string;
    let current: Stats;
    let currentPathAfter: string;
    try {
      currentPathBefore = operations.realpath(absolutePath);
      if (!isWithinCacheDir(currentPathBefore, realCacheDir)) {
        return { ok: false, issue: 'unsafe-file' };
      }
      current = operations.stat(currentPathBefore);
      currentPathAfter = operations.realpath(absolutePath);
    } catch (error) {
      return writeVerificationFailure(error);
    }

    if (
      currentPathAfter !== currentPathBefore ||
      !isWithinCacheDir(currentPathAfter, realCacheDir) ||
      !current.isFile()
    ) {
      return { ok: false, issue: 'unsafe-file' };
    }
    if (
      hasStableFileIdentity(opened) &&
      hasStableFileIdentity(current) &&
      !hasMatchingFileIdentity(opened, current)
    ) {
      return { ok: false, issue: 'unsafe-file' };
    }

    try {
      operations.truncate(fd, 0);
      operations.write(fd, text);
      return { ok: true, path: absolutePath };
    } catch (error) {
      return { ok: false, issue: 'write-error', error };
    }
  } finally {
    if (fd !== null) {
      try {
        operations.close(fd);
      } catch {
        // Closing cannot change whether the write crossed the cache boundary.
      }
    }
  }
}

function writeOpenFailure(error: unknown): ContainedCacheWriteResult {
  const code = errnoCode(error);
  if (code === 'ELOOP' || code === 'EEXIST' || code === 'ENOTDIR') {
    return { ok: false, issue: 'unsafe-file', error };
  }
  return { ok: false, issue: 'write-error', error };
}

function writeVerificationFailure(error: unknown): ContainedCacheWriteResult {
  const code = errnoCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
    return { ok: false, issue: 'unsafe-file', error };
  }
  return { ok: false, issue: 'write-error', error };
}
