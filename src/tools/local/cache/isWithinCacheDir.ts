import { sep } from 'path';

export function isWithinCacheDir(absolutePath: string, cacheDir: string): boolean {
  return absolutePath === cacheDir || absolutePath.startsWith(cacheDir + sep);
}
