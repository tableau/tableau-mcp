import { dirname, resolve, sep } from 'path';

import { DesktopCache } from '../../../desktop/cache.js';

export function getCacheDir(): string {
  return resolve(dirname(new DesktopCache().getCacheFilePath({ prefix: '_', id: '_' })));
}

// True only when absolutePath is the cache dir itself or a descendant of it.
// A raw startsWith(cacheDir) check is unsafe: a sibling like `<dir>-evil` or
// `<dir>XYZ.xml` shares the prefix and would escape containment.
export function isWithinCacheDir(absolutePath: string, cacheDir: string): boolean {
  return absolutePath === cacheDir || absolutePath.startsWith(cacheDir + sep);
}
