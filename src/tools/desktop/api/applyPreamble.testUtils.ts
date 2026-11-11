import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Err, Ok } from 'ts-results-es';

import * as cachePathModule from '../../../desktop/cachePath.js';
import { CacheFileWriteError } from '../../../errors/mcpToolError.desktop.js';
import { FileNotFoundError, FileReadError } from '../../../errors/mcpToolError.js';

/** Keep legacy apply-tool unit fixtures focused on tool behavior while the preamble suite owns
 * real descriptor/containment coverage. The fs calls remain observable to existing assertions. */
export function mockContainedCacheReadFromFs(): void {
  vi.mocked(cachePathModule.readContainedCacheTextFile).mockImplementation((path) => {
    if (path.endsWith('.meta.json')) {
      return { ok: false, issue: cachePathModule.CONTAINED_CACHE_READ_ISSUE.missing };
    }
    if (!existsSync(path)) {
      return { ok: false, issue: cachePathModule.CONTAINED_CACHE_READ_ISSUE.missing };
    }
    try {
      const contents = readFileSync(path, 'utf-8');
      return { ok: true, path, text: contents.toString() };
    } catch (error) {
      return { ok: false, issue: cachePathModule.CONTAINED_CACHE_READ_ISSUE.readError, error };
    }
  });
}

/** Write-side and argument-helper twin of {@link mockContainedCacheReadFromFs}: the cache-file
 * argument helpers run against the mocked `fs` so legacy fixtures with fake paths keep observing
 * their reads and writes. Containment itself is covered with a real temp cache dir. */
export function mockCacheFileArgsFromFs(): void {
  vi.mocked(cachePathModule.resolveCacheFileArg).mockImplementation((_argName, raw) =>
    Ok(resolve(raw.trim())),
  );
  vi.mocked(cachePathModule.checkCacheFileArg).mockImplementation((_argName, raw, notFound) => {
    const path = resolve(raw.trim());
    return existsSync(path) ? Ok(path) : Err(notFound?.(raw) ?? new FileNotFoundError(raw));
  });
  vi.mocked(cachePathModule.readCacheFileArg).mockImplementation((_argName, raw, notFound) => {
    const path = resolve(raw.trim());
    if (!existsSync(path)) {
      return Err(notFound?.(raw) ?? new FileNotFoundError(raw));
    }
    try {
      return Ok({ path, text: readFileSync(path, 'utf-8').toString() });
    } catch (error) {
      return Err(new FileReadError(error));
    }
  });
  vi.mocked(cachePathModule.writeCacheFileArg).mockImplementation((argName, raw, text) => {
    const path = resolve(raw.trim());
    try {
      writeFileSync(path, text, 'utf-8');
      return Ok(path);
    } catch (error) {
      return Err(new CacheFileWriteError(argName, error));
    }
  });
}
