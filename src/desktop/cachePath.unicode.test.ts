import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  checkCacheFileArg,
  isLexicallyWithinCacheDir,
  readCacheFileArg,
  readContainedCacheTextFile,
  resolveCacheFileArg,
  writeContainedCacheTextFile,
} from './cachePath.js';

const realOperations = {
  open: openSync,
  fstat: fstatSync,
  stat: statSync,
  read: (fd: number) => readFileSync(fd),
  close: closeSync,
};
const NAMES = ['내 Tableau 리포지토리 (Beta)', 'マイ Tableau リポジトリ'];
const nfc = (s: string): string => s.normalize('NFC');
const nfd = (s: string): string => s.normalize('NFD');

describe('isLexicallyWithinCacheDir', () => {
  const name = NAMES[0];
  const dir = `/c/${nfd(name)}`;

  for (const [platform, inside] of [
    ['darwin', true],
    ['linux', false],
  ] as const) {
    it(`${platform}: NFD dir with NFC path and NFC dir with NFD path`, () => {
      expect(isLexicallyWithinCacheDir(`/c/${nfc(name)}/a.xml`, dir, platform)).toBe(inside);
      expect(isLexicallyWithinCacheDir(`/c/${nfd(name)}/a.xml`, `/c/${nfc(name)}`, platform)).toBe(
        inside,
      );
    });

    it(`${platform}: rejects sibling prefix and parent traversal`, () => {
      expect(isLexicallyWithinCacheDir(`/c/${nfc(name)}-evil/x.xml`, dir, platform)).toBe(false);
      expect(isLexicallyWithinCacheDir(`/c/${nfc(name)}/../x.xml`, dir, platform)).toBe(false);
    });
  }
});

describe('realpath containment stays exact', () => {
  let root: string;
  let cacheDir: string;
  let sibling: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cache-unicode-hfs-'));
    cacheDir = join(root, 'cache\u00C5');
    sibling = join(root, 'cache\u212B');
    mkdirSync(cacheDir);
    vi.stubEnv('TABLEAU_MCP_CACHE_DIR', cacheDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a file that resolves to an NFC-equal but byte-distinct sibling dir', () => {
    const file = join(cacheDir, 'secret.xml');
    writeFileSync(file, 'secret');
    const operations = {
      ...realOperations,
      stat: () => statSync(file),
      realpath: (p: string) => (p === cacheDir ? cacheDir : join(sibling, 'secret.xml')),
    };
    expect(readContainedCacheTextFile(file, operations)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
  });

  it('refuses to create a file when the parent resolves to an NFC-equal sibling dir', () => {
    const flagsSeen: number[] = [];
    const realpaths = [cacheDir, sibling];
    const operations = {
      noFollowFlag: 0,
      open: (_path: string, flags: number): number => {
        flagsSeen.push(flags);
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      fstat: fstatSync,
      stat: statSync,
      truncate: () => undefined,
      write: () => undefined,
      close: closeSync,
      realpath: () => realpaths.shift() as string,
    };
    expect(writeContainedCacheTextFile(join(cacheDir, 'new.xml'), 'x', operations)).toMatchObject({
      ok: false,
      issue: 'unsafe-file',
    });
    expect(flagsSeen.every((flags) => (flags & constants.O_CREAT) === 0)).toBe(true);
  });
});

describe.skipIf(process.platform !== 'darwin')('darwin real file system', () => {
  const state = { root: '' };

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(state.root, { recursive: true, force: true });
  });

  function setup(name: string): { nfdDir: string; nfcDir: string } {
    state.root = mkdtempSync(join(tmpdir(), 'cache-unicode-'));
    const nfdDir = join(state.root, nfd(name));
    mkdirSync(nfdDir);
    writeFileSync(join(nfdDir, 'a.xml'), '<workbook/>');
    vi.stubEnv('TABLEAU_MCP_CACHE_DIR', nfdDir);
    return { nfdDir, nfcDir: join(state.root, nfc(name)) };
  }

  for (const name of NAMES) {
    it(`reads via NFC spelling: ${name}`, () => {
      const { nfcDir } = setup(name);
      const result = readContainedCacheTextFile(join(nfcDir, 'a.xml'));
      expect(result).toMatchObject({ ok: true, text: '<workbook/>' });
    });
  }

  it('overwrites an existing file and creates a new direct child', () => {
    const { nfdDir, nfcDir } = setup(NAMES[0]);
    expect(writeContainedCacheTextFile(join(nfcDir, 'a.xml'), 'one').ok).toBe(true);
    expect(readFileSync(join(nfdDir, 'a.xml'), 'utf-8')).toBe('one');
    expect(writeContainedCacheTextFile(join(nfcDir, 'new.xml'), 'two').ok).toBe(true);
    expect(readFileSync(join(nfdDir, 'new.xml'), 'utf-8')).toBe('two');
  });

  it('file-arg helpers accept the NFC spelling', () => {
    const { nfcDir } = setup(NAMES[0]);
    const file = join(nfcDir, 'a.xml');
    expect(readCacheFileArg('f', file).isOk()).toBe(true);
    expect(checkCacheFileArg('f', file).isOk()).toBe(true);
    expect(resolveCacheFileArg('f', file).isOk()).toBe(true);
  });
});
