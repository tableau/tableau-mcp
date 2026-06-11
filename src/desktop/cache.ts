import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { getDirname } from '../utils/getDirname.js';

export class DesktopCache {
  private readonly _cacheDirectory: string;
  private readonly _id?: string;

  constructor(id?: string) {
    this._id = id;
    this._cacheDirectory = join(getDirname(), '..', 'cache');

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
    extension?: 'xml' | 'json';
  }): string {
    extension = extension || 'xml';
    id = id || this._id || `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return join(this._cacheDirectory, `${prefix}-${id}.${extension}`);
  }
}
