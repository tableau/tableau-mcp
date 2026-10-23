import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

import { getDirname } from '../utils/getDirname.js';

const CACHE_DIR_ENV_NAME = 'TABLEAU_MCP_CACHE_DIR';

// Each Tableau Agent session runs its own MCP process and points it at a per-session directory
// so concurrent sessions don't overwrite each other's cache files. Only a non-blank absolute
// path is honored; a blank or relative value is ignored (falls back to the default) because a
// relative path would silently depend on the process's working directory.
function resolveCacheDirectory(): string {
  const override = process.env[CACHE_DIR_ENV_NAME]?.trim();
  if (override && isAbsolute(override)) {
    return resolve(override);
  }
  return join(getDirname(), '..', 'cache');
}

export class DesktopCache {
  private readonly _cacheDirectory: string;
  private readonly _id?: string;

  constructor(id?: string) {
    this._id = id;
    this._cacheDirectory = resolveCacheDirectory();

    if (!existsSync(this._cacheDirectory)) {
      mkdirSync(this._cacheDirectory, { recursive: true });
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
    extension = extension || 'xml';
    id = id || this._id || `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return join(this._cacheDirectory, `${prefix}-${id}.${extension}`);
  }
}
