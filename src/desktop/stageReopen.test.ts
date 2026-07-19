import { deriveStageSiblingPath, reopenFromStage } from './stageReopen.js';

const stagePath = '/tmp/Tableau Stages/parameter stage.twb';
const discoveryDir = '/tmp/Tableau Discovery';
const appBundle = '/Applications/Tableau Desktop (Apple silicon) main.app';
const oldCommand = `${appBundle}/Contents/MacOS/Tableau ${stagePath}`;

describe('reopenFromStage', () => {
  it('derives an app bundle with spaces and launches using an args array', async () => {
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === 'ps' && args[1] === '123') {
        return { stdout: `${oldCommand}\n`, stderr: '' };
      }
      if (file === 'ps' && args[1] === '456') {
        return { stdout: `${oldCommand}\n`, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const readdir = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue(['456.json']);
    const readFile = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        instanceId: 'instance-456',
        pid: 456,
        baseUrl: 'http://127.0.0.1:456',
        token: 'token-456',
      }),
    );
    const fetchFn = vi.fn(async () => ({ status: 200 }));

    const result = await reopenFromStage({
      stagePath,
      oldPid: '123',
      discoveryDir,
      deps: {
        execFile,
        readdir,
        readFile,
        fetchFn,
        sleep: vi.fn(async () => undefined),
        isPidAlive: vi.fn(() => true),
      },
    });

    expect(result.isOk()).toBe(true);
    expect(execFile).toHaveBeenCalledWith('open', ['-n', '-a', appBundle, stagePath]);
  });

  it('errors when the old process command does not contain an app bundle', async () => {
    const execFile = vi.fn(async () => ({ stdout: '/usr/bin/not-tableau\n', stderr: '' }));

    const result = await reopenFromStage({
      stagePath,
      oldPid: '123',
      discoveryDir,
      deps: {
        execFile,
        readdir: vi.fn(),
        readFile: vi.fn(),
        fetchFn: vi.fn(),
        sleep: vi.fn(async () => undefined),
        isPidAlive: vi.fn(() => true),
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('does not contain a .app bundle');
    }
    expect(execFile).not.toHaveBeenCalledWith('open', expect.anything());
  });

  it('ignores pre-existing manifests, dead pids, and commands not opened from the stage path', async () => {
    const execFile = vi.fn(async (file: string, args: string[]) => {
      if (file === 'ps' && args[1] === '123') {
        return { stdout: `${oldCommand}\n`, stderr: '' };
      }
      if (file === 'ps' && args[1] === '201') {
        return { stdout: `${appBundle}/Contents/MacOS/Tableau /tmp/other.twb\n`, stderr: '' };
      }
      if (file === 'ps' && args[1] === '202') {
        return { stdout: `${oldCommand}\n`, stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const readdir = vi
      .fn()
      .mockResolvedValueOnce(['100.json'])
      .mockResolvedValue(['100.json', '200.json', '201.json', '202.json']);
    const readFile = vi.fn(async (path: string) => {
      const pid = path.endsWith('201.json') ? 201 : 202;
      return JSON.stringify({
        schemaVersion: 1,
        instanceId: `instance-${pid}`,
        pid,
        baseUrl: `http://127.0.0.1:${pid}`,
        token: `token-${pid}`,
      });
    });
    const isPidAlive = vi.fn((pid: number) => pid !== 200);

    const result = await reopenFromStage({
      stagePath,
      oldPid: '123',
      discoveryDir,
      deps: {
        execFile,
        readdir,
        readFile,
        fetchFn: vi.fn(async () => ({ status: 200 })),
        sleep: vi.fn(async () => undefined),
        isPidAlive,
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.newPid).toBe('202');
      expect(result.value.baseUrl).toBe('http://127.0.0.1:202');
    }
  });

  it('retries workbook document polling until the API answers HTTP 200', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValue({ status: 200 });
    const sleep = vi.fn(async () => undefined);

    const result = await reopenFromStage({
      stagePath,
      oldPid: '123',
      discoveryDir,
      deps: {
        execFile: vi.fn(async (file: string, args: string[]) => {
          if (file === 'ps' && args[1] === '123') {
            return { stdout: `${oldCommand}\n`, stderr: '' };
          }
          return { stdout: `${oldCommand}\n`, stderr: '' };
        }),
        readdir: vi.fn().mockResolvedValueOnce([]).mockResolvedValue(['456.json']),
        readFile: vi.fn(async () =>
          JSON.stringify({
            schemaVersion: 1,
            instanceId: 'instance-456',
            pid: 456,
            baseUrl: 'http://127.0.0.1:456',
            token: 'token-456',
          }),
        ),
        fetchFn,
        sleep,
        isPidAlive: vi.fn(() => true),
      },
    });

    expect(result.isOk()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:456/v0/workbook/document', {
      headers: { Authorization: 'Bearer token-456' },
    });
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('returns an actionable timeout when the reopened API never becomes ready', async () => {
    const result = await reopenFromStage({
      stagePath,
      oldPid: '123',
      discoveryDir,
      deps: {
        execFile: vi.fn(async (file: string, args: string[]) => {
          if (file === 'ps' && args[1] === '123') {
            return { stdout: `${oldCommand}\n`, stderr: '' };
          }
          return { stdout: `${oldCommand}\n`, stderr: '' };
        }),
        readdir: vi.fn().mockResolvedValueOnce([]).mockResolvedValue(['456.json']),
        readFile: vi.fn(async () =>
          JSON.stringify({
            schemaVersion: 1,
            instanceId: 'instance-456',
            pid: 456,
            baseUrl: 'http://127.0.0.1:456',
            token: 'token-456',
          }),
        ),
        fetchFn: vi.fn(async () => ({ status: 503 })),
        sleep: vi.fn(async () => undefined),
        isPidAlive: vi.fn(() => true),
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'Timed out waiting for reopened Tableau Desktop API at http://127.0.0.1:456',
      );
    }
  });
});

describe('deriveStageSiblingPath', () => {
  const APP = "/Applications/Tableau Desktop (Apple silicon) main.app/Contents/MacOS/Tableau";

  it('derives the first free .param-stage-<n> sibling of the open workbook (spaces in path)', async () => {
    const result = await deriveStageSiblingPath({
      oldPid: '123',
      deps: {
        execFile: vi.fn(async () => ({
          stdout: `${APP} /Users/m/My Stages/solfa stage.twb\n`,
          stderr: '',
        })),
        exists: vi.fn((path: string) => path.endsWith('.param-stage-1.twb')),
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('/Users/m/My Stages/solfa stage.param-stage-2.twb');
    }
  });

  it('strips a chained .param-stage-<n> suffix so repeated reopens do not compound', async () => {
    const result = await deriveStageSiblingPath({
      oldPid: '123',
      deps: {
        execFile: vi.fn(async () => ({
          stdout: `${APP} /tmp/s/base.param-stage-3.twb\n`,
          stderr: '',
        })),
        exists: vi.fn(() => false),
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('/tmp/s/base.param-stage-1.twb');
    }
  });

  it('errors actionably when the process has no open .twb file argument', async () => {
    const result = await deriveStageSiblingPath({
      oldPid: '123',
      deps: {
        execFile: vi.fn(async () => ({ stdout: `${APP}\n`, stderr: '' })),
        exists: vi.fn(() => false),
      },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain('pass stagePath explicitly');
    }
  });
});
