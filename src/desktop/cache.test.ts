import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { DesktopCache } from './cache.js';
import {
  getCacheDir,
  readContainedCacheTextFile,
  writeContainedCacheTextFile,
} from './cachePath.js';

const ENV = 'TABLEAU_MCP_CACHE_DIR';

describe('DesktopCache TABLEAU_MCP_CACHE_DIR override', () => {
  const temporaryPaths: string[] = [];
  const originalValue = process.env[ENV];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV];
    } else {
      process.env[ENV] = originalValue;
    }
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function overrideRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'mcp-cache-override-'));
    temporaryPaths.push(root);
    return root;
  }

  function defaultCacheDir(): string {
    delete process.env[ENV];
    return getCacheDir();
  }

  it('uses the env directory for cache file paths, creating it if missing', () => {
    const root = join(overrideRoot(), 'nested', 'session');
    process.env[ENV] = root;

    const path = new DesktopCache('abc').getCacheFilePath({ prefix: 'p' });

    expect(path).toBe(join(root, 'p-abc.xml'));
    expect(getCacheDir()).toBe(resolve(root));
  });

  it.each(['', '   ', 'relative/cache'])('ignores %j and keeps the default directory', (value) => {
    const expected = defaultCacheDir();
    process.env[ENV] = value;

    expect(getCacheDir()).toBe(expected);
  });

  it('allows contained read/write under the override and rejects the default dir', () => {
    const defaultDir = defaultCacheDir();
    const root = overrideRoot();
    process.env[ENV] = root;

    const inside = new DesktopCache('x').getCacheFilePath({ prefix: 'w' });
    expect(writeContainedCacheTextFile(inside, '<a/>')).toEqual({ ok: true, path: inside });
    expect(readContainedCacheTextFile(inside)).toEqual({ ok: true, path: inside, text: '<a/>' });

    const inDefault = join(defaultDir, 'w-x.xml');
    expect(writeContainedCacheTextFile(inDefault, '<a/>')).toEqual({
      ok: false,
      issue: 'outside-cache',
    });
    expect(readContainedCacheTextFile(inDefault)).toEqual({ ok: false, issue: 'outside-cache' });
  });
});
