import { spawnSync } from 'child_process';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

import { FileNotFoundError } from '../errors/mcpToolError.js';
import {
  checkCacheFileArg,
  readCacheFileArg,
  readContainedCacheTextFile,
  writeCacheFileArg,
  writeContainedCacheTextFile,
} from './cachePath.js';

const state = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('./cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(state.cacheDir, `${prefix}-${id ?? 'default'}.xml`);
    }
  },
}));

describe('cache-file argument helpers', () => {
  let root: string;
  let inside: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cache-arg-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(state.cacheDir);
    mkdirSync(join(root, 'outside'));
    inside = join(state.cacheDir, 'a.xml');
    outside = join(root, 'outside', 'victim.xml');
    writeFileSync(inside, '<workbook/>');
    writeFileSync(outside, 'original');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a cache file and trims the argument', () => {
    const result = readCacheFileArg('workbookFile', `  ${inside}  `);
    expect(result.isOk() && result.value.text).toBe('<workbook/>');
  });

  it('refuses to read, check or write an outside file and leaves it untouched', () => {
    const read = readCacheFileArg('workbookFile', outside);
    const check = checkCacheFileArg('workbookFile', outside);
    const write = writeCacheFileArg('workbookFile', outside, 'overwritten');
    for (const result of [read, check, write]) {
      expect(result.isErr() && result.error.type).toBe('cache-file-outside-cache');
    }
    expect(readFileSync(outside, 'utf-8')).toBe('original');
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a symlink inside the cache that points outside',
    () => {
      const link = join(state.cacheDir, 'link.xml');
      symlinkSync(outside, link);

      for (const result of [
        readCacheFileArg('workbookFile', link),
        checkCacheFileArg('workbookFile', link),
        writeCacheFileArg('workbookFile', link, 'overwritten'),
      ]) {
        expect(result.isErr() && result.error.type).toBe('cache-file-outside-cache');
      }
      expect(readFileSync(outside, 'utf-8')).toBe('original');
    },
  );

  it('accepts an ordinary cache file in the existence check', () => {
    const result = checkCacheFileArg('workbookFile', inside);
    expect(result.isOk() && result.value).toBe(inside);
  });

  it('maps a missing file to the caller-supplied not-found error', () => {
    const missing = join(state.cacheDir, 'does-not-exist.xml');
    for (const result of [
      readCacheFileArg('workbookFile', missing, (path) => new FileNotFoundError(path)),
      checkCacheFileArg('workbookFile', missing, (path) => new FileNotFoundError(path)),
    ]) {
      expect(result.isErr() && result.error).toBeInstanceOf(FileNotFoundError);
    }
  });
});

describe('missing-file messages do not reveal what exists outside the cache', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cache-oracle-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(state.cacheDir);
    mkdirSync(join(root, 'outside'));
    writeFileSync(join(root, 'outside', 'present.xml'), 'x');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'answers the same for a present and a missing file under a planted directory symlink',
    () => {
      symlinkSync(join(root, 'outside'), join(state.cacheDir, 'd'));
      for (const name of ['present.xml', 'missing.xml']) {
        const file = join(state.cacheDir, 'd', name);
        for (const result of [
          readCacheFileArg('workbookFile', file),
          checkCacheFileArg('workbookFile', file),
        ]) {
          expect(result.isErr() && result.error.type).toBe('cache-file-outside-cache');
        }
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'answers the same for a nested missing path under a planted directory symlink',
    () => {
      symlinkSync(join(root, 'outside'), join(state.cacheDir, 'd'));
      for (const name of ['d/missing.twb', 'd/nope/missing.twb', 'd/nope/deeper/missing.twb']) {
        const file = join(state.cacheDir, name);
        for (const result of [
          readCacheFileArg('workbookFile', file),
          checkCacheFileArg('workbookFile', file),
        ]) {
          expect(result.isErr() && result.error.type).toBe('cache-file-outside-cache');
        }
      }
    },
  );

  it('keeps plain not-found for a missing file inside the cache, including its own notFound text', () => {
    for (const name of ['nope.xml', 'sub/nope.xml', 'sub/deeper/nope.xml']) {
      const file = join(state.cacheDir, name);
      const plain = checkCacheFileArg('workbookFile', file);
      expect(plain.isErr() && plain.error.type).not.toBe('cache-file-outside-cache');
      expect(plain.isErr() && plain.error.message).toContain('workbookFile does not exist');
      const custom = checkCacheFileArg('workbookFile', file, (p) => new FileNotFoundError(p));
      expect(custom.isErr() && custom.error).toBeInstanceOf(FileNotFoundError);
    }
  });

  it('words a plain missing cache file without a double period', () => {
    const result = readCacheFileArg('workbookFile', join(state.cacheDir, 'missing.xml'));
    expect(result.isErr() && result.error.message).not.toContain('..');
    expect(result.isErr() && result.error.message).toContain('workbookFile does not exist');
  });
});

describe.skipIf(process.platform === 'win32')('a FIFO planted in the cache', () => {
  let scratch: string;
  let fifo = '';

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'cache-fifo-'));
  });

  afterEach(() => {
    if (fifo) rmSync(fifo, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  // Runs in a child against the real cache dir so a blocking open fails by timeout, not by hanging vitest.
  it('is refused by read, write and check without blocking', { timeout: 20000 }, () => {
    const cachePathModule = pathToFileURL(join(process.cwd(), 'src/desktop/cachePath.ts')).href;
    const script = join(scratch, 'probe.mts');
    writeFileSync(
      script,
      `import { execFileSync } from 'child_process';
import { join } from 'path';
import { checkCacheFileArg, getCacheDir, readContainedCacheTextFile, writeContainedCacheTextFile } from ${JSON.stringify(cachePathModule)};
const fifo = join(getCacheDir(), 'fifo-probe-' + process.pid + '.twb');
console.log(fifo);
execFileSync('mkfifo', [fifo]);
let refused = 0;
if (readContainedCacheTextFile(fifo).ok === false) refused++;
if (writeContainedCacheTextFile(fifo, 'x').ok === false) refused++;
if (checkCacheFileArg('workbookFile', fifo).isErr()) refused++;
console.log('REFUSED=' + refused);
`,
    );

    const child = spawnSync(process.execPath, ['--import', 'tsx', script], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      timeout: 8000,
    });
    fifo = child.stdout.split('\n')[0] ?? '';

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('REFUSED=3');
  });
});

describe.skipIf(process.platform === 'win32')('hardlinks to files outside the cache', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cache-hardlink-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(state.cacheDir);
    mkdirSync(join(root, 'outside'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('are refused by the contained reader and writer', () => {
    const victim = join(root, 'outside', 'victim.xml');
    writeFileSync(victim, 'original');
    const linked = join(state.cacheDir, 'linked.xml');
    linkSync(victim, linked);
    const mtime = statSync(victim).mtimeMs;

    expect(readContainedCacheTextFile(linked)).toMatchObject({ ok: false, issue: 'unsafe-file' });
    expect(writeContainedCacheTextFile(linked, 'overwritten')).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
    expect(readFileSync(victim, 'utf-8')).toBe('original');
    expect(statSync(victim).mtimeMs).toBe(mtime);
  });
});
