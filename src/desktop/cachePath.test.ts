import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
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
  getCacheDir,
  readContainedCacheTextFile,
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
    symlinkSync(outsideFile, candidate);

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
    symlinkSync(outside, join(directory, 'linked'));

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
        symlinkSync(outsideSidecar, candidate);
      } else {
        symlinkSync(outside, join(directory, 'linked'));
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

function withInode(stats: Stats, ino: number): Stats {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(stats)), stats) as Stats;
  Object.defineProperty(copy, 'ino', { value: ino, configurable: true });
  return copy;
}
