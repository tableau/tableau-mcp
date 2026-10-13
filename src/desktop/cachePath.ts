import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'fs';
import path, { dirname, resolve } from 'path';
import { Err, Ok, Result } from 'ts-results-es';

import { CacheFileOutsideCacheError, CacheFileWriteError } from '../errors/mcpToolError.desktop.js';
import { FileReadError, McpToolError } from '../errors/mcpToolError.js';
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

// A FIFO or device planted in the cache must fail the regular-file check, not hang the open.
const NON_BLOCKING = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0;

export function getCacheDir(): string {
  return resolve(dirname(new DesktopCache().getCacheFilePath({ prefix: '_', id: '_' })));
}

// True only when absolutePath is the cache dir itself or a descendant of it.
// A raw startsWith(cacheDir) check is unsafe: a sibling like `<dir>-evil` or
// `<dir>XYZ.xml` shares the prefix and would escape containment. path.relative
// also compares case-insensitively on win32 and rejects other drives.
export function isWithinCacheDir(
  absolutePath: string,
  cacheDir: string,
  pathApi: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'> = path,
): boolean {
  const rel = pathApi.relative(cacheDir, absolutePath);
  return (
    rel === '' || (rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel))
  );
}

function isSamePath(a: string, b: string, pathApi: Pick<typeof path, 'relative'> = path): boolean {
  return pathApi.relative(a, b) === '';
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
      fd = operations.open(absolutePath, constants.O_RDONLY | noFollow | NON_BLOCKING);
    } catch (error) {
      return openFailure(error);
    }

    let opened: Stats;
    try {
      opened = operations.fstat(fd);
    } catch (error) {
      return { ok: false, issue: 'read-error', error };
    }
    if (!opened.isFile() || opened.nlink > 1) {
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
      fd = operations.open(absolutePath, constants.O_RDWR | operations.noFollowFlag | NON_BLOCKING);
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') {
        return writeOpenFailure(error);
      }

      // DesktopCache emits direct children. Limiting creation to that shape avoids
      // claiming nested parent traversal is race-safe without an openat-style API.
      if (!isSamePath(dirname(absolutePath), cacheDir)) {
        return { ok: false, issue: 'unsupported-new-path' };
      }
      let realParent: string;
      try {
        realParent = operations.realpath(dirname(absolutePath));
      } catch (parentError) {
        return { ok: false, issue: 'write-error', error: parentError };
      }
      if (!isSamePath(realParent, realCacheDir)) {
        return { ok: false, issue: 'unsafe-file' };
      }
      try {
        fd = operations.open(
          absolutePath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            operations.noFollowFlag |
            NON_BLOCKING,
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
    if (!opened.isFile() || opened.nlink > 1) {
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

/**
 * The one owner of "does this tool argument name a cache file?". Call it at the parameter
 * boundary, before any existence check, so outside paths never learn whether a file exists.
 */
export function resolveCacheFileArg(argName: string, raw: string): Result<string, McpToolError> {
  const absolutePath = resolve(raw.trim());
  return isWithinCacheDir(absolutePath, getCacheDir())
    ? new Ok(absolutePath)
    : new Err(new CacheFileOutsideCacheError(argName));
}

/**
 * Existence check with the contained reader's rule (no symlink, real path inside the cache) and
 * no read, for callers that only need the path before a Desktop round trip.
 */
export function checkCacheFileArg(
  argName: string,
  raw: string,
  notFound?: (path: string) => McpToolError,
): Result<string, McpToolError> {
  const resolved = resolveCacheFileArg(argName, raw);
  if (resolved.isErr()) return resolved;
  try {
    const link = lstatSync(resolved.value);
    const real = realpathSync(resolved.value);
    if (
      link.isSymbolicLink() ||
      !link.isFile() ||
      link.nlink > 1 ||
      !isWithinCacheDir(real, realpathSync(getCacheDir()))
    ) {
      return new Err(new CacheFileOutsideCacheError(argName));
    }
    return new Ok(resolved.value);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      return new Err(missingCacheFileError(argName, resolved.value, raw, notFound));
    }
    return new Err(new CacheFileOutsideCacheError(argName));
  }
}

/** A missing path under a planted directory symlink must look the same as an outside path. */
function missingCacheFileError(
  argName: string,
  absolutePath: string,
  raw: string,
  notFound?: (path: string) => McpToolError,
): McpToolError {
  try {
    let ancestor = dirname(absolutePath);
    for (;;) {
      try {
        if (!isWithinCacheDir(realpathSync(ancestor), realpathSync(getCacheDir()))) {
          return new CacheFileOutsideCacheError(argName);
        }
        break;
      } catch (error) {
        const parent = dirname(ancestor);
        if (errnoCode(error) !== 'ENOENT' || parent === ancestor) throw error;
        ancestor = parent;
      }
    }
  } catch {
    // An unresolvable ancestor is lexically inside the cache, so plain "missing" reveals nothing.
  }
  return notFound?.(raw) ?? new FileReadError(new Error(`${argName} does not exist`));
}

/** Contained read of a cache-file argument; `notFound` lets a tool keep its own missing-file error. */
export function readCacheFileArg(
  argName: string,
  raw: string,
  notFound?: (path: string) => McpToolError,
): Result<{ path: string; text: string }, McpToolError> {
  const resolved = resolveCacheFileArg(argName, raw);
  if (resolved.isErr()) return resolved;
  const read = readContainedCacheTextFile(resolved.value);
  if (read.ok) return new Ok({ path: read.path, text: read.text });
  switch (read.issue) {
    case CONTAINED_CACHE_READ_ISSUE.outsideCache:
    case CONTAINED_CACHE_READ_ISSUE.unsafeFile:
      return new Err(new CacheFileOutsideCacheError(argName));
    case CONTAINED_CACHE_READ_ISSUE.missing:
      return new Err(missingCacheFileError(argName, resolved.value, raw, notFound));
    default:
      return new Err(new FileReadError(read.error ?? new Error(`Unable to read ${argName}.`)));
  }
}

/** Contained write for paths the server minted itself; throws so existing cache-write handlers keep working. */
export function writeCacheTextFile(path: string, text: string): void {
  const written = writeContainedCacheTextFile(path, text);
  if (written.ok) return;
  if (written.issue === CONTAINED_CACHE_WRITE_ISSUE.writeError) throw written.error;
  throw new Error(
    `refused to write ${path}: it must be a regular file inside the Desktop cache directory`,
  );
}

/** Contained write of a cache-file argument; a write failure is never reported as a read failure. */
export function writeCacheFileArg(
  argName: string,
  raw: string,
  text: string,
): Result<string, McpToolError> {
  const resolved = resolveCacheFileArg(argName, raw);
  if (resolved.isErr()) return resolved;
  const written = writeContainedCacheTextFile(resolved.value, text);
  if (written.ok) return new Ok(written.path);
  switch (written.issue) {
    case CONTAINED_CACHE_WRITE_ISSUE.outsideCache:
    case CONTAINED_CACHE_WRITE_ISSUE.unsafeFile:
      return new Err(new CacheFileOutsideCacheError(argName));
    case CONTAINED_CACHE_WRITE_ISSUE.unsupportedNewPath:
      return new Err(
        new CacheFileWriteError(
          argName,
          new Error('new cache files must be direct children of the cache directory'),
        ),
      );
    default:
      return new Err(new CacheFileWriteError(argName, written.error));
  }
}
