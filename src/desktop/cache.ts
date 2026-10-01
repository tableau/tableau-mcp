import { createHash } from 'crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'fs';
import { dirname, join, sep } from 'path';

import { getDesktopConfig } from '../config.desktop.js';
import { getDirname } from '../utils/getDirname.js';
import { discoverInstances } from './externalApi/discovery.js';

export class StrictDesktopCacheScopeUnavailableError extends Error {
  constructor(pid: string) {
    super(
      `Strict Desktop cache scope is unavailable because owned instance ${pid} is not discoverable.`,
    );
    this.name = 'StrictDesktopCacheScopeUnavailableError';
  }
}

function legacyCacheDirectory(): string {
  return join(getDirname(), '..', 'cache');
}

function cacheDirectory(): string {
  const legacyRoot = legacyCacheDirectory();
  const config = getDesktopConfig();
  if (config.desktopSessionScope !== 'strict') return legacyRoot;
  const pid = config.desktopSessionId!;
  const instance = discoverInstances({
    discoveryDir: config.externalApiDiscoveryDir,
    targetPid: Number(pid),
  }).find((candidate) => String(candidate.pid) === pid);
  if (!instance?.instanceId) throw new StrictDesktopCacheScopeUnavailableError(pid);
  const instanceHash = createHash('sha256').update(instance.instanceId).digest('hex').slice(0, 16);
  return join(legacyRoot, `session-${pid}-${instanceHash}`);
}

function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function ensureStrictCacheRoot(cacheRoot: string, pid: string): void {
  const legacyRoot = legacyCacheDirectory();
  const existingLegacyRoot = lstatIfPresent(legacyRoot);
  if (
    existingLegacyRoot?.isSymbolicLink() ||
    (existingLegacyRoot && !existingLegacyRoot.isDirectory())
  ) {
    throw new StrictDesktopCacheScopeUnavailableError(pid);
  }
  if (!existingLegacyRoot) mkdirSync(legacyRoot, { recursive: true });

  const realLegacyRoot = realpathSync(legacyRoot);
  const existingCacheRoot = lstatIfPresent(cacheRoot);
  if (
    existingCacheRoot?.isSymbolicLink() ||
    (existingCacheRoot && !existingCacheRoot.isDirectory())
  ) {
    throw new StrictDesktopCacheScopeUnavailableError(pid);
  }
  if (!existingCacheRoot) mkdirSync(cacheRoot);

  const realCacheRoot = realpathSync(cacheRoot);
  if (
    dirname(realCacheRoot) !== realLegacyRoot &&
    !realCacheRoot.startsWith(realLegacyRoot + sep)
  ) {
    throw new StrictDesktopCacheScopeUnavailableError(pid);
  }
}

export class DesktopCache {
  private readonly _id?: string;

  constructor(id?: string) {
    this._id = id;
    if (getDesktopConfig().desktopSessionScope === 'ordinary') {
      const legacyRoot = cacheDirectory();
      if (!existsSync(legacyRoot)) mkdirSync(legacyRoot, { recursive: true });
    }
  }

  getCacheFilePath({
    prefix,
    id,
    extension,
  }: {
    prefix: string;
    id?: string;
    extension?: 'xml' | 'json' | 'png' | 'svg';
  }): string {
    const cacheRoot = cacheDirectory();
    const config = getDesktopConfig();
    if (config.desktopSessionScope === 'strict') {
      ensureStrictCacheRoot(cacheRoot, config.desktopSessionId!);
    } else if (!existsSync(cacheRoot)) {
      mkdirSync(cacheRoot, { recursive: true });
    }
    extension = extension || 'xml';
    id = id || this._id || `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    if (config.desktopSessionScope === 'strict') {
      prefix = encodeURIComponent(prefix);
      id = encodeURIComponent(id);
    }
    const cacheFile = join(cacheRoot, `${prefix}-${id}.${extension}`);
    if (config.desktopSessionScope === 'strict') {
      try {
        const existing = lstatSync(cacheFile);
        if (existing.isSymbolicLink() || !existing.isFile()) {
          throw new StrictDesktopCacheScopeUnavailableError(config.desktopSessionId!);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return cacheFile;
  }
}
