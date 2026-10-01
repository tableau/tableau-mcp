import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
} from 'fs';
import { dirname, resolve, sep } from 'path';

import { getDesktopConfig } from '../config.desktop.js';
import { DesktopCache } from './cache.js';

export interface ContainedCacheReadOperations {
  open(path: string, flags: number): number;
  fstat(fd: number): Stats;
  realpath(path: string): string;
  stat(path: string): Stats;
  read(fd: number): Buffer;
  close(fd: number): void;
}

export const CONTAINED_CACHE_READ_ISSUE = {
  outsideCache: 'outside-cache',
  scopeUnavailable: 'scope-unavailable',
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

const DEFAULT_CONTAINED_CACHE_READ_OPERATIONS: ContainedCacheReadOperations = {
  open: openSync,
  fstat: fstatSync,
  realpath: realpathSync,
  stat: statSync,
  read: (fd) => readFileSync(fd),
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

function usesOwnedCacheRootSpelling(
  absolutePath: string,
  cacheDir: string,
  realCacheDir: string,
): boolean {
  return isWithinCacheDir(absolutePath, cacheDir) || isWithinCacheDir(absolutePath, realCacheDir);
}

export type StrictCachePathGuardResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'scope-unavailable' | 'outside-cache' | 'unsafe-file'; error?: unknown };

/** Ordinary mode is unchanged; strict mode accepts only paths inside the owned instance root. */
export function guardStrictCachePath(path: string): StrictCachePathGuardResult {
  const absolutePath = resolve(path);
  if (getDesktopConfig().desktopSessionScope !== 'strict') return { ok: true, path: absolutePath };

  let cacheDir: string;
  let realCacheDir: string;
  try {
    cacheDir = getCacheDir();
    realCacheDir = realpathSync(cacheDir);
  } catch (error) {
    return { ok: false, reason: 'scope-unavailable', error };
  }
  if (!usesOwnedCacheRootSpelling(absolutePath, cacheDir, realCacheDir)) {
    return { ok: false, reason: 'outside-cache' };
  }

  try {
    let targetExists = true;
    let targetStats: Stats | undefined;
    try {
      targetStats = lstatSync(absolutePath);
    } catch (error) {
      if (errnoCode(error) !== 'ENOENT') throw error;
      targetExists = false;
    }
    if (targetExists) {
      if (!targetStats?.isFile() || targetStats.isSymbolicLink()) {
        return { ok: false, reason: 'unsafe-file' };
      }
      const realTarget = realpathSync(absolutePath);
      if (!isWithinCacheDir(realTarget, realCacheDir) || !statSync(realTarget).isFile()) {
        return { ok: false, reason: 'unsafe-file' };
      }
    } else {
      const realParent = realpathSync(dirname(absolutePath));
      if (!isWithinCacheDir(realParent, realCacheDir)) {
        return { ok: false, reason: 'unsafe-file' };
      }
    }
  } catch (error) {
    return { ok: false, reason: 'unsafe-file', error };
  }
  return { ok: true, path: absolutePath };
}

export function strictCachePathError(path: string, result: StrictCachePathGuardResult): string {
  const detail = result.ok ? '' : ` (${result.reason})`;
  return `Security error: cached artifact path is outside the owned strict Desktop cache scope${detail}.\n\nRequested: ${resolve(path)}`;
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
  const absolutePath = resolve(path);
  let realCacheDir: string;
  if (getDesktopConfig().desktopSessionScope === 'strict') {
    let cacheDir: string;
    try {
      cacheDir = getCacheDir();
      realCacheDir = operations.realpath(cacheDir);
    } catch (error) {
      return { ok: false, issue: 'scope-unavailable', error };
    }
    if (!usesOwnedCacheRootSpelling(absolutePath, cacheDir, realCacheDir)) {
      return { ok: false, issue: 'outside-cache' };
    }
  } else {
    const cacheDir = getCacheDir();
    if (!isWithinCacheDir(absolutePath, cacheDir)) {
      return { ok: false, issue: 'outside-cache' };
    }
    try {
      realCacheDir = operations.realpath(cacheDir);
    } catch (error) {
      return { ok: false, issue: 'read-error', error };
    }
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
