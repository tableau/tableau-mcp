import { homedir } from 'os';
import { join } from 'path';

import { discoverInstances, getExternalApiDiscoveryDir } from './discovery.js';

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('../../logging/logger.js', () => ({
  log: vi.fn(),
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
    });

    expect(instances).toEqual([]);
  });

  it('skips files whose schemaVersion is not 1', () => {
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['bad.json'],
      readFile: () => validFile({ schemaVersion: 2 }),
      isPidAlive: () => true,
    });

    expect(instances).toEqual([]);
  });

  it('skips files that are not valid JSON', () => {
    const instances = discoverInstances({
      discoveryDir: '/discovery',
      readDir: () => ['broken.json'],
      readFile: () => 'not json at all',
      isPidAlive: () => true,
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
    });

    expect(instances).toEqual([]);
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
  it('uses the macOS Application Support path', () => {
    const dir = getExternalApiDiscoveryDir({}, 'darwin');
    expect(dir).toBe(
      join('/home/testuser', 'Library', 'Application Support', 'Tableau', 'ExternalApi'),
    );
  });

  it('uses LOCALAPPDATA on Windows', () => {
    const dir = getExternalApiDiscoveryDir(
      { LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' },
      'win32',
    );
    expect(dir).toBe(join('C:\\Users\\t\\AppData\\Local', 'Tableau', 'ExternalApi'));
  });

  it('falls back to a homedir-derived LOCALAPPDATA on Windows when unset', () => {
    const dir = getExternalApiDiscoveryDir({}, 'win32');
    expect(dir).toBe(join('/home/testuser', 'AppData', 'Local', 'Tableau', 'ExternalApi'));
  });

  it('uses XDG_DATA_HOME on Linux', () => {
    const dir = getExternalApiDiscoveryDir(
      { XDG_DATA_HOME: '/home/testuser/.local/share' },
      'linux',
    );
    expect(dir).toBe(join('/home/testuser/.local/share', 'Tableau', 'ExternalApi'));
  });
});
