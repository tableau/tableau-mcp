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

  afterEach(() => {
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
    vi.stubEnv(ENV, undefined);
    return getCacheDir();
  }

  it('uses the env directory for cache file paths, creating it if missing', () => {
    const root = join(overrideRoot(), 'nested', 'session');
    vi.stubEnv(ENV, root);

    const path = new DesktopCache('abc').getCacheFilePath({ prefix: 'p' });

    expect(path).toBe(join(root, 'p-abc.xml'));
    expect(getCacheDir()).toBe(resolve(root));
  });

  it.each(['', '   ', 'relative/cache'])('ignores %j and keeps the default directory', (value) => {
    const expected = defaultCacheDir();
    vi.stubEnv(ENV, value);

    expect(getCacheDir()).toBe(expected);
  });

  it('trims whitespace around an absolute override', () => {
    const root = overrideRoot();
    vi.stubEnv(ENV, `  ${root}  `);

    expect(getCacheDir()).toBe(resolve(root));
  });

  it('allows contained read/write under the override and rejects the default dir', () => {
    const defaultDir = defaultCacheDir();
    const root = overrideRoot();
    vi.stubEnv(ENV, root);

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
