import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  type ContainedCacheReadOperations,
  type ContainedCacheWriteOperations,
  getCacheDir,
  readContainedCacheTextFile,
  writeContainedCacheTextFile,
} from './cachePath.js';

describe('readContainedCacheTextFile', () => {
  const temporaryPaths: string[] = [];

  afterEach(() => {
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function cacheDirectory(label: string): string {
    const directory = mkdtempSync(join(getCacheDir(), `contained-cache-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function outsideDirectory(label: string): string {
    const directory = mkdtempSync(join(tmpdir(), `contained-cache-outside-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function defaultOperations(
    overrides: Partial<ContainedCacheReadOperations> = {},
  ): ContainedCacheReadOperations {
    return {
      open: (path: string, flags: number) => openSync(path, flags),
      fstat: (fd: number) => fstatSync(fd),
      realpath: (path: string) => realpathSync(path),
      stat: (path: string) => statSync(path),
      read: (fd: number) => readFileSync(fd),
      close: (fd: number) => closeSync(fd),
      ...overrides,
    } satisfies ContainedCacheReadOperations;
  }

  it('rejects lexical sibling and traversal paths before opening them', () => {
    const open = vi.fn(() => {
      throw new Error('must not open');
    });
    const operations = defaultOperations({ open });
    const cacheDir = getCacheDir();

    expect(readContainedCacheTextFile(`${cacheDir}-evil/file.xml`, operations)).toMatchObject({
      ok: false,
      issue: 'outside-cache',
    });
    expect(
      readContainedCacheTextFile(join(cacheDir, '..', 'escaped-datasource.xml'), operations),
    ).toMatchObject({ ok: false, issue: 'outside-cache' });
    expect(open).not.toHaveBeenCalled();
  });

  it('reads regular datasource and sidecar files inside the real cache root', () => {
    const directory = cacheDirectory('valid');
    const datasourceFile = join(directory, 'datasource.xml');
    const sidecarFile = `${datasourceFile}.meta.json`;
    writeFileSync(datasourceFile, '<datasource name="sales"/>');
    writeFileSync(sidecarFile, '{"instanceId":"safe"}');

    expect(readContainedCacheTextFile(datasourceFile)).toEqual({
      ok: true,
      path: datasourceFile,
      text: '<datasource name="sales"/>',
    });
    expect(readContainedCacheTextFile(sidecarFile)).toEqual({
      ok: true,
      path: sidecarFile,
      text: '{"instanceId":"safe"}',
    });
  });

  it('opens read-only with no-follow semantics when the platform exposes them', () => {
    const directory = cacheDirectory('open-flags');
    const file = join(directory, 'datasource.xml');
    writeFileSync(file, '<datasource/>');
    const open = vi.fn((path: string, flags: number) => openSync(path, flags));

    expect(readContainedCacheTextFile(file, defaultOperations({ open })).ok).toBe(true);
    const flags = open.mock.calls[0]?.[1] ?? 0;
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    expect(flags).toBe(constants.O_RDONLY | noFollow);
  });

  it('rejects a final-component symlink that escapes the cache', () => {
    const directory = cacheDirectory('final-symlink');
    const outside = outsideDirectory('final-symlink');
    const outsideFile = join(outside, 'secret.xml');
    const candidate = join(directory, 'datasource.xml');
    writeFileSync(outsideFile, '<outside-secret/>');
    symlinkSync(outsideFile, candidate, 'file');

    expect(readContainedCacheTextFile(candidate)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
  });

  it('rejects an intermediate-directory symlink that escapes the cache', () => {
    const directory = cacheDirectory('intermediate-symlink');
    const outside = outsideDirectory('intermediate-symlink');
    const outsideFile = join(outside, 'datasource.xml');
    writeFileSync(outsideFile, '<outside-secret/>');
    symlinkSync(outside, join(directory, 'linked'), directoryLinkType());

    expect(readContainedCacheTextFile(join(directory, 'linked', 'datasource.xml'))).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
  });

  it.each(['final', 'intermediate'] as const)(
    'rejects a %s sidecar symlink escape without reading external contents',
    (linkKind) => {
      const directory = cacheDirectory(`sidecar-${linkKind}`);
      const outside = outsideDirectory(`sidecar-${linkKind}`);
      const outsideSidecar = join(outside, 'datasource.xml.meta.json');
      writeFileSync(outsideSidecar, '{"source_sha256":"external-secret"}');
      const read = vi.fn((fd: number) => readFileSync(fd));
      const operations = defaultOperations({ read });
      let candidate: string;
      if (linkKind === 'final') {
        candidate = join(directory, 'datasource.xml.meta.json');
        symlinkSync(outsideSidecar, candidate, 'file');
      } else {
        symlinkSync(outside, join(directory, 'linked'), directoryLinkType());
        candidate = join(directory, 'linked', 'datasource.xml.meta.json');
      }

      expect(readContainedCacheTextFile(candidate, operations)).toMatchObject({
        ok: false,
        issue: 'unsafe-file',
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('rejects an opened/current identity mismatch without reading and closes the descriptor', () => {
    const directory = cacheDirectory('identity-mismatch');
    const file = join(directory, 'datasource.xml');
    writeFileSync(file, '<datasource/>');
    const read = vi.fn((fd: number) => readFileSync(fd));
    const close = vi.fn((fd: number) => closeSync(fd));
    const operations = defaultOperations({
      stat: (path) => withInode(statSync(path), statSync(path).ino + 1),
      read,
      close,
    });

    expect(readContainedCacheTextFile(file, operations)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects a candidate whose real path changes across the current-file stat', () => {
    const directory = cacheDirectory('realpath-change');
    const file = join(directory, 'datasource.xml');
    const replacement = join(directory, 'replacement.xml');
    writeFileSync(file, '<datasource/>');
    writeFileSync(replacement, '<datasource replacement="true"/>');
    const read = vi.fn((fd: number) => readFileSync(fd));
    const close = vi.fn((fd: number) => closeSync(fd));
    let candidateRealpathCalls = 0;
    const operations = defaultOperations({
      realpath: (path) => {
        if (path === getCacheDir()) return realpathSync(path);
        candidateRealpathCalls += 1;
        return candidateRealpathCalls === 1 ? realpathSync(file) : realpathSync(replacement);
      },
      read,
      close,
    });

    expect(readContainedCacheTextFile(file, operations)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the descriptor after both a successful read and a read failure', () => {
    const directory = cacheDirectory('close');
    const file = join(directory, 'datasource.xml');
    writeFileSync(file, '<datasource/>');
    const closeAfterSuccess = vi.fn((fd: number) => closeSync(fd));

    expect(
      readContainedCacheTextFile(file, defaultOperations({ close: closeAfterSuccess })).ok,
    ).toBe(true);
    expect(closeAfterSuccess).toHaveBeenCalledTimes(1);

    const closeAfterFailure = vi.fn((fd: number) => closeSync(fd));
    const failure = readContainedCacheTextFile(
      file,
      defaultOperations({
        read: () => {
          throw new Error('read failed');
        },
        close: closeAfterFailure,
      }),
    );
    expect(failure).toMatchObject({ ok: false, issue: 'read-error' });
    expect(closeAfterFailure).toHaveBeenCalledTimes(1);
  });

  it('classifies a missing file separately from unreadable and unsafe files', () => {
    const directory = cacheDirectory('classify');
    const missing = join(directory, 'missing.xml');
    const unreadable = join(directory, 'unreadable.xml');
    const nonFile = join(directory, 'directory.xml');
    writeFileSync(unreadable, '<datasource/>');
    mkdirSync(nonFile);

    expect(readContainedCacheTextFile(missing)).toMatchObject({ ok: false, issue: 'missing' });
    expect(
      readContainedCacheTextFile(
        unreadable,
        defaultOperations({
          open: () => {
            const error = new Error('permission denied') as NodeJS.ErrnoException;
            error.code = 'EACCES';
            throw error;
          },
        }),
      ),
    ).toMatchObject({ ok: false, issue: 'read-error' });
    expect(readContainedCacheTextFile(nonFile)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
  });
});

describe('writeContainedCacheTextFile', () => {
  const temporaryPaths: string[] = [];

  afterEach(() => {
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function cacheDirectory(label: string): string {
    const directory = mkdtempSync(join(getCacheDir(), `contained-cache-write-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function outsideDirectory(label: string): string {
    const directory = mkdtempSync(join(tmpdir(), `contained-cache-write-outside-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function defaultOperations(
    overrides: Partial<ContainedCacheWriteOperations> = {},
  ): ContainedCacheWriteOperations {
    return {
      noFollowFlag: typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0,
      open: (path: string, flags: number, mode?: number) => openSync(path, flags, mode),
      fstat: (fd: number) => fstatSync(fd),
      realpath: (path: string) => realpathSync(path),
      stat: (path: string) => statSync(path),
      truncate: (fd: number, length: number) => ftruncateSync(fd, length),
      write: (fd: number, text: string) => writeFileSync(fd, text, 'utf-8'),
      close: (fd: number) => closeSync(fd),
      ...overrides,
    } satisfies ContainedCacheWriteOperations;
  }

  it('updates an existing regular file through the verified descriptor', () => {
    const directory = cacheDirectory('existing');
    const file = join(directory, 'worksheet.xml');
    writeFileSync(file, '<worksheet name="before"/>');

    expect(writeContainedCacheTextFile(file, '<worksheet name="after"/>')).toEqual({
      ok: true,
      path: file,
    });
    expect(readFileSync(file, 'utf-8')).toBe('<worksheet name="after"/>');
  });

  it('opens an existing file read-write without truncation or symlink following', () => {
    const directory = cacheDirectory('existing-flags');
    const file = join(directory, 'worksheet.xml');
    writeFileSync(file, '<before/>');
    const open = vi.fn((path: string, flags: number, mode?: number) => openSync(path, flags, mode));

    expect(writeContainedCacheTextFile(file, '<after/>', defaultOperations({ open })).ok).toBe(
      true,
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[1]).toBe(
      constants.O_RDWR | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0),
    );
    expect((open.mock.calls[0]?.[1] ?? 0) & constants.O_TRUNC).toBe(0);
  });

  it('creates a missing direct child of the verified cache root', () => {
    const file = join(getCacheDir(), `contained-cache-new-${process.pid}-${Date.now()}.xml`);
    temporaryPaths.push(file);

    expect(writeContainedCacheTextFile(file, '<worksheet/>')).toEqual({ ok: true, path: file });
    expect(readFileSync(file, 'utf-8')).toBe('<worksheet/>');
  });

  it('creates with exclusive no-follow flags and without truncation', () => {
    const file = join(getCacheDir(), `contained-cache-new-flags-${process.pid}-${Date.now()}.xml`);
    temporaryPaths.push(file);
    const open = vi.fn((path: string, flags: number, mode?: number) => openSync(path, flags, mode));
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

    expect(writeContainedCacheTextFile(file, '<worksheet/>', defaultOperations({ open })).ok).toBe(
      true,
    );
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0]?.[1]).toBe(constants.O_RDWR | noFollow);
    expect(open.mock.calls[1]?.[1]).toBe(
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    );
    expect(open.mock.calls[1]?.[2]).toBe(0o600);
    expect((open.mock.calls[1]?.[1] ?? 0) & constants.O_TRUNC).toBe(0);
  });

  it('rejects a missing nested path rather than claiming it can create it race-safely', () => {
    const directory = cacheDirectory('nested-new');
    const nested = join(directory, 'missing.xml');

    expect(writeContainedCacheTextFile(nested, '<worksheet/>')).toMatchObject({
      ok: false,
      issue: 'unsupported-new-path',
    });
    expect(() => readFileSync(nested)).toThrow();
  });

  it('rejects final and intermediate symlink escapes without changing the external target', () => {
    const directory = cacheDirectory('symlinks');
    const outside = outsideDirectory('symlinks');
    const external = join(outside, 'external.xml');
    writeFileSync(external, '<outside/>');

    const finalLink = join(directory, 'final.xml');
    symlinkSync(external, finalLink, 'file');
    expect(writeContainedCacheTextFile(finalLink, '<escaped/>')).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });

    const linkedDirectory = join(directory, 'linked');
    symlinkSync(outside, linkedDirectory, directoryLinkType());
    expect(
      writeContainedCacheTextFile(join(linkedDirectory, 'external.xml'), '<escaped/>'),
    ).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
    expect(readFileSync(external, 'utf-8')).toBe('<outside/>');
  });

  it('does not truncate or write before descriptor identity verification succeeds', () => {
    const directory = cacheDirectory('identity-mismatch');
    const file = join(directory, 'worksheet.xml');
    writeFileSync(file, '<before/>');
    const truncate = vi.fn((fd: number, length: number) => ftruncateSync(fd, length));
    const write = vi.fn((fd: number, text: string) => writeFileSync(fd, text, 'utf-8'));
    const close = vi.fn((fd: number) => closeSync(fd));
    const operations = defaultOperations({
      stat: (path) => withInode(statSync(path), statSync(path).ino + 1),
      truncate,
      write,
      close,
    });

    expect(writeContainedCacheTextFile(file, '<after/>', operations)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
    expect(truncate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(readFileSync(file, 'utf-8')).toBe('<before/>');
  });

  it('rejects a final symlink before truncation when no no-follow flag is available', () => {
    const directory = cacheDirectory('no-no-follow');
    const outside = outsideDirectory('no-no-follow');
    const external = join(outside, 'external.xml');
    const candidate = join(directory, 'candidate.xml');
    writeFileSync(external, '<outside/>');
    symlinkSync(external, candidate, 'file');
    const truncate = vi.fn((fd: number, length: number) => ftruncateSync(fd, length));
    const write = vi.fn((fd: number, text: string) => writeFileSync(fd, text, 'utf-8'));

    expect(
      writeContainedCacheTextFile(
        candidate,
        '<escaped/>',
        defaultOperations({ noFollowFlag: 0, truncate, write }),
      ),
    ).toMatchObject({ ok: false, issue: 'unsafe-file' });
    expect(truncate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(readFileSync(external, 'utf-8')).toBe('<outside/>');
  });

  it('keeps writing through the verified descriptor if the path is replaced after verification', () => {
    const directory = cacheDirectory('held-descriptor');
    const file = join(directory, 'worksheet.xml');
    const openedFile = join(directory, 'opened.xml');
    writeFileSync(file, '<before/>');
    let replaced = false;
    const operations = defaultOperations({
      truncate: (fd, length) => {
        renameSync(file, openedFile);
        writeFileSync(file, '<replacement/>');
        replaced = true;
        ftruncateSync(fd, length);
      },
    });

    expect(writeContainedCacheTextFile(file, '<after/>', operations)).toEqual({
      ok: true,
      path: file,
    });
    expect(replaced).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('<replacement/>');
    expect(readFileSync(openedFile, 'utf-8')).toBe('<after/>');
  });
});

function withInode(stats: Stats, ino: number): Stats {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats) as Stats;
  Object.defineProperty(copy, 'ino', { value: ino, configurable: true });
  return copy;
}

function directoryLinkType(): 'dir' | 'junction' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}
