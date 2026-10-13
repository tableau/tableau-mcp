import { spawnSync } from 'child_process';
import {
  chmodSync,
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
  writeCacheTextFile,
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
      writeFileSync(join(root, 'outside', 'regular.txt'), 'x');
      for (const name of [
        'd/missing.twb',
        'd/nope/missing.twb',
        'd/nope/deeper/missing.twb',
        'd/regular.txt/sub/x.twb',
      ]) {
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

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'gives the Security error, not errno text, for an unreadable outside directory',
    () => {
      const locked = join(root, 'locked');
      mkdirSync(locked);
      writeFileSync(join(locked, 'x.twb'), 'x');
      symlinkSync(locked, join(state.cacheDir, 'l'));
      chmodSync(locked, 0o000);
      try {
        const result = readCacheFileArg('workbookFile', join(state.cacheDir, 'l', 'x.twb'));
        expect(result.isErr() && result.error.type).toBe('cache-file-outside-cache');
        expect(result.isErr() && result.error.message).not.toContain('EACCES');
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'gives the Security error for an unreadable outside directory at depth 2 and deeper',
    () => {
      const locked = join(root, 'locked');
      mkdirSync(join(locked, 'sub'), { recursive: true });
      writeFileSync(join(locked, 'sub', 'f.twb'), 'x');
      symlinkSync(locked, join(state.cacheDir, 'l'));
      chmodSync(locked, 0o000);
      try {
        for (const name of ['l/sub/f.twb', 'l/sub/nope/f.twb', 'l/nope/a/b.twb']) {
          const result = readCacheFileArg('workbookFile', join(state.cacheDir, name));
          expect(result.isErr() && result.error.type).toBe('cache-file-outside-cache');
          expect(result.isErr() && result.error.message).not.toContain('EACCES');
        }
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'answers a dangling directory symlink exactly like a live one',
    () => {
      symlinkSync(join(root, 'outside'), join(state.cacheDir, 'live'));
      symlinkSync(join(root, 'no-such-dir'), join(state.cacheDir, 'dangling'));
      for (const tail of ['x.twb', 'a/b/x.twb']) {
        for (const read of [readCacheFileArg, checkCacheFileArg]) {
          const live = read('workbookFile', join(state.cacheDir, 'live', tail));
          const dangling = read('workbookFile', join(state.cacheDir, 'dangling', tail));
          expect(dangling.isErr() && dangling.error.type).toBe('cache-file-outside-cache');
          expect(dangling.isErr() && dangling.error.message).toBe(
            live.isErr() ? live.error.message : undefined,
          );
        }
      }
    },
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps the errno text for an unreadable file inside the cache',
    () => {
      const file = join(state.cacheDir, 'secret.twb');
      writeFileSync(file, 'x');
      chmodSync(file, 0o000);
      const result = readCacheFileArg('workbookFile', file);
      expect(result.isErr() && result.error.type).not.toBe('cache-file-outside-cache');
      expect(result.isErr() && result.error.message).toContain('EACCES');
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
import { rmSync } from 'fs';
import { join } from 'path';
import { checkCacheFileArg, getCacheDir, readContainedCacheTextFile, writeContainedCacheTextFile } from ${JSON.stringify(cachePathModule)};
const fifo = join(getCacheDir(), 'fifo-probe-' + process.pid + '.twb');
console.log(fifo);
rmSync(fifo, { force: true });
execFileSync('mkfifo', [fifo]);
const read = readContainedCacheTextFile(fifo);
const write = writeContainedCacheTextFile(fifo, 'x');
console.log('READ=' + (read.ok ? 'ok' : read.issue));
console.log('WRITE=' + (write.ok ? 'ok' : write.issue));
console.log('CHECK=' + (checkCacheFileArg('workbookFile', fifo).isErr() ? 'err' : 'ok'));
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
    expect(child.stdout).toContain('READ=unsafe-file');
    expect(child.stdout).toContain('WRITE=unsafe-file');
    expect(child.stdout).toContain('CHECK=err');
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

describe('writeCacheTextFile refusal text', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cache-write-text-'));
    state.cacheDir = join(root, 'cache');
    mkdirSync(join(state.cacheDir, 'sub'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('says where new files must go when a new file is not a direct child of the cache', () => {
    expect(() => writeCacheTextFile(join(state.cacheDir, 'sub', 'new.xml'), 'x')).toThrow(
      'new cache files must be created directly in the Desktop cache directory',
    );
  });

  it('keeps the regular-file text for an outside path', () => {
    expect(() => writeCacheTextFile(join(root, 'elsewhere.xml'), 'x')).toThrow(
      'it must be a regular file inside the Desktop cache directory',
    );
  });
});
