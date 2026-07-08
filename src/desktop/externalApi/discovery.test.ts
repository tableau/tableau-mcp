import { homedir } from 'os';
import { join } from 'path';

import {
  defaultIsDiscoveryFileTrusted,
  defaultIsProcessTableau,
  discoverInstances,
  getExternalApiDiscoveryDir,
  getExternalApiDiscoveryDirs,
} from './discovery.js';
import { isLoopbackBaseUrl } from './types.js';

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('../../logging/logger.js', () => ({
  log: vi.fn(),
}));

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}));

const validFile = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    instanceId: 'inst-1',
    pid: 12345,
    baseUrl: 'http://127.0.0.1:51000',
    tokenType: 'Bearer',
    token: 'tok-1',
    applicationVersion: '2026.1',
    apiVersion: '1.0',
    startedAt: '2026-07-07T10:00:00Z',
    ...overrides,
  });

/** Trust-gate deps that reproduce pre-W60 behavior: every file is trusted and every
 * alive pid is treated as a real Tableau process — isolates tests that predate the
 * W60 hardening pass from the new gates unless they explicitly opt in. */
const trusting = { isFileTrusted: (): boolean => true, isProcessTableau: (): boolean => true };

describe('discoverInstances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(homedir).mockReturnValue('/home/testuser');
  });

  it('parses a valid schemaVersion 1 discovery file into an instance', () => {
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['12345.json'],
      readFile: () => validFile(),
      isPidAlive: () => true,
      ...trusting,
    });

    expect(instances).toEqual([
      {
        baseUrl: 'http://127.0.0.1:51000',
        token: 'tok-1',
        pid: 12345,
        instanceId: 'inst-1',
        apiVersion: '1.0',
      },
    ]);
  });

  it('skips entries whose pid is dead', () => {
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['12345.json'],
      readFile: () => validFile(),
      isPidAlive: () => false,
      ...trusting,
    });

    expect(instances).toEqual([]);
  });

  it('skips files whose schemaVersion is not 1', () => {
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['bad.json'],
      readFile: () => validFile({ schemaVersion: 2 }),
      isPidAlive: () => true,
      ...trusting,
    });

    expect(instances).toEqual([]);
  });

  it('skips files that are not valid JSON', () => {
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['broken.json'],
      readFile: () => 'not json at all',
      isPidAlive: () => true,
      ...trusting,
    });

    expect(instances).toEqual([]);
  });

  it('ignores non-json files in the discovery directory', () => {
    const readFile = vi.fn(() => validFile());
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['12345.json', 'notes.txt', '.DS_Store'],
      readFile,
      isPidAlive: () => true,
      ...trusting,
    });

    expect(instances).toHaveLength(1);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('returns instances newest-first by startedAt', () => {
    const files: Record<string, string> = {
      'old.json': validFile({
        instanceId: 'old',
        pid: 111,
        startedAt: '2026-07-07T09:00:00Z',
      }),
      'new.json': validFile({
        instanceId: 'new',
        pid: 222,
        startedAt: '2026-07-07T12:00:00Z',
      }),
    };

    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => Object.keys(files),
      readFile: (path) => files[path.split('/').pop() as string],
      isPidAlive: () => true,
      ...trusting,
    });

    expect(instances.map((i) => i.instanceId)).toEqual(['new', 'old']);
  });

  it('returns an empty array when the discovery directory cannot be read', () => {
    const instances = discoverInstances({
      discoveryDir: '/nope',
      readDir: () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      readFile: () => validFile(),
      isPidAlive: () => true,
      ...trusting,
    });

    expect(instances).toEqual([]);
  });

  // ── W60 P0-1 Fix 1: loopback-only baseUrl allowlist ──────────────────────────
  describe('loopback-only baseUrl allowlist (W60 P0-1 fix 1)', () => {
    it('skips a file whose baseUrl is a non-loopback host', () => {
      const instances = discoverInstances({
        discoveryDir: '/discovery',
        readDir: () => ['forged.json'],
        readFile: () => validFile({ baseUrl: 'https://attacker.example.com/' }),
        isPidAlive: () => true,
        ...trusting,
      });

      expect(instances).toEqual([]);
    });

    it.each([
      ['http://127.0.0.1.evil.com/', 'suffix-appended IPv4 lookalike'],
      ['http://notlocalhost/', 'suffix-appended localhost lookalike'],
    ])('skips a baseUrl bypass attempt: %s (%s)', (baseUrl) => {
      const instances = discoverInstances({
        discoveryDir: '/discovery',
        readDir: () => ['forged.json'],
        readFile: () => validFile({ baseUrl }),
        isPidAlive: () => true,
        ...trusting,
      });

      expect(instances).toEqual([]);
    });

    it.each([
      ['http://127.0.0.1:51000/', '127.0.0.1'],
      ['http://localhost:51000/', 'localhost'],
      ['http://[::1]:51000/', '::1'],
    ])('accepts an allowed loopback host: %s (%s)', (baseUrl) => {
      const instances = discoverInstances({
        discoveryDir: '/discovery',
        readDir: () => ['ok.json'],
        readFile: () => validFile({ baseUrl }),
        isPidAlive: () => true,
        ...trusting,
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].baseUrl).toBe(baseUrl);
    });
  });

  describe('isLoopbackBaseUrl', () => {
    it('accepts the three allowed loopback hosts', () => {
      expect(isLoopbackBaseUrl('http://127.0.0.1:51000/')).toBe(true);
      expect(isLoopbackBaseUrl('http://localhost:51000/')).toBe(true);
      expect(isLoopbackBaseUrl('http://[::1]:51000/')).toBe(true);
    });

    it('strips IPv6 brackets before matching', () => {
      expect(isLoopbackBaseUrl('http://[::1]/')).toBe(true);
    });

    it('rejects non-loopback and lookalike hosts', () => {
      expect(isLoopbackBaseUrl('https://attacker.example.com/')).toBe(false);
      expect(isLoopbackBaseUrl('http://127.0.0.1.evil.com/')).toBe(false);
      expect(isLoopbackBaseUrl('http://notlocalhost/')).toBe(false);
    });

    it('rejects unparseable values', () => {
      expect(isLoopbackBaseUrl('not a url')).toBe(false);
    });
  });

  // ── W60 P0-1 Fix 2: file-ownership/permission trust gate ─────────────────────
  describe('file-ownership/permission trust gate (W60 P0-1 fix 2)', () => {
    it('skips a file when isFileTrusted (injected) returns false', () => {
      const readFile = vi.fn(() => validFile());
      const instances = discoverInstances({
        discoveryDir: '/discovery',
        readDir: () => ['12345.json'],
        readFile,
        isPidAlive: () => true,
        isFileTrusted: () => false,
        isProcessTableau: () => true,
      });

      expect(instances).toEqual([]);
      expect(readFile).not.toHaveBeenCalled();
    });
  });

  // ── W60 P0-1 Fix 3 (process-identity check): skip pids that aren't Tableau ───
  describe('process-identity check (W60 P0-1 fix 3, defense-in-depth)', () => {
    it('skips an alive pid whose isProcessTableau (injected) returns false', () => {
      const instances = discoverInstances({
        discoveryDir: '/discovery',
        readDir: () => ['12345.json'],
        readFile: () => validFile(),
        isPidAlive: () => true,
        isFileTrusted: () => true,
        isProcessTableau: () => false,
      });

      expect(instances).toEqual([]);
    });
  });
});

describe('defaultIsDiscoveryFileTrusted', () => {
  const REAL_UID = 501;

  beforeEach(() => {
    vi.spyOn(process, 'getuid' as never).mockReturnValue(REAL_UID as never);
  });

  it('trusts a file owned by the current uid with mode 0600', () => {
    const statFile = (): { uid: number; mode: number } => ({ uid: REAL_UID, mode: 0o100600 });
    expect(defaultIsDiscoveryFileTrusted('/f', 'darwin', statFile)).toBe(true);
  });

  it('trusts a file owned by the current uid with mode 0644 (world-readable, not writable)', () => {
    const statFile = (): { uid: number; mode: number } => ({ uid: REAL_UID, mode: 0o100644 });
    expect(defaultIsDiscoveryFileTrusted('/f', 'darwin', statFile)).toBe(true);
  });

  it('does not trust a group-writable file (mode 0664)', () => {
    const statFile = (): { uid: number; mode: number } => ({ uid: REAL_UID, mode: 0o100664 });
    expect(defaultIsDiscoveryFileTrusted('/f', 'darwin', statFile)).toBe(false);
  });

  it('does not trust a file owned by a different uid', () => {
    const statFile = (): { uid: number; mode: number } => ({ uid: REAL_UID + 1, mode: 0o100600 });
    expect(defaultIsDiscoveryFileTrusted('/f', 'darwin', statFile)).toBe(false);
  });

  it('fails closed when stat throws', () => {
    const statFile = (): { uid: number; mode: number } => {
      throw new Error('ENOENT');
    };
    expect(defaultIsDiscoveryFileTrusted('/f', 'darwin', statFile)).toBe(false);
  });

  it('is trusted regardless of stat on win32 (documented accepted gap)', () => {
    const statFile = (): { uid: number; mode: number } => {
      throw new Error('should never be called on win32');
    };
    expect(defaultIsDiscoveryFileTrusted('/f', 'win32', statFile)).toBe(true);
  });
});

describe('defaultIsProcessTableau', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it.each(['Tableau', 'tableau', 'TableauDesktop'])(
    'returns true for a Tableau-named comm output: %s',
    (comm) => {
      execFileSyncMock.mockReturnValue(`${comm}\n`);
      expect(defaultIsProcessTableau(123, 'darwin')).toBe(true);
    },
  );

  it('returns false for an unrelated comm name', () => {
    execFileSyncMock.mockReturnValue('Finder\n');
    expect(defaultIsProcessTableau(123, 'darwin')).toBe(false);
  });

  it('fails closed when execFileSync throws', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('no such process');
    });
    expect(defaultIsProcessTableau(123, 'darwin')).toBe(false);
  });

  it('returns true unconditionally on win32', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('should never be called on win32');
    });
    expect(defaultIsProcessTableau(123, 'win32')).toBe(true);
  });
});

describe('getExternalApiDiscoveryDir', () => {
  it('honors an explicit override env var', () => {
    const dir = getExternalApiDiscoveryDir(
      { TABLEAU_EXTERNAL_API_DISCOVERY_DIR: '/custom/dir' },
      'darwin',
    );
    expect(dir).toBe('/custom/dir');
  });

  // `path.join` uses the runtime host's separator; expectations are built with
  // `join` so these tests verify the *root selection* per platform rather than a
  // host-specific separator.
  it('uses the macOS Application Support path (doubled Tableau segment first)', () => {
    const dir = getExternalApiDiscoveryDir({}, 'darwin');
    expect(dir).toBe(
      join('/home/testuser', 'Library', 'Application Support', 'Tableau', 'Tableau', 'ExternalApi'),
    );
  });

  it('returns the doubled-segment candidate first and the collapsed form as fallback', () => {
    const dirs = getExternalApiDiscoveryDirs(
      { LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' },
      'win32',
    );
    // Live-confirmed 2026-07-07 (Windows): %LOCALAPPDATA%\Tableau\Tableau\ExternalApi\<pid>.json
    expect(dirs).toEqual([
      join('C:\\Users\\t\\AppData\\Local', 'Tableau', 'Tableau', 'ExternalApi'),
      join('C:\\Users\\t\\AppData\\Local', 'Tableau', 'ExternalApi'),
    ]);
  });

  it('uses LOCALAPPDATA on Windows', () => {
    const dir = getExternalApiDiscoveryDir(
      { LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' },
      'win32',
    );
    expect(dir).toBe(join('C:\\Users\\t\\AppData\\Local', 'Tableau', 'Tableau', 'ExternalApi'));
  });

  it('falls back to a homedir-derived LOCALAPPDATA on Windows when unset', () => {
    const dir = getExternalApiDiscoveryDir({}, 'win32');
    expect(dir).toBe(
      join('/home/testuser', 'AppData', 'Local', 'Tableau', 'Tableau', 'ExternalApi'),
    );
  });

  it('uses XDG_DATA_HOME on Linux', () => {
    const dir = getExternalApiDiscoveryDir(
      { XDG_DATA_HOME: '/home/testuser/.local/share' },
      'linux',
    );
    expect(dir).toBe(join('/home/testuser/.local/share', 'Tableau', 'Tableau', 'ExternalApi'));
  });
});
