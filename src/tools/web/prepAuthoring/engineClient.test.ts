import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { runPrepEngine } from './engineClient.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

describe('fixed Prep engine subprocess protocol', () => {
  const config = { enabled: true, python: resolve('python'), workspace: resolve('workspace') };
  let child: EventEmitter & {
    stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    child = Object.assign(new EventEmitter(), {
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    mocks.spawn.mockReturnValue(child);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('uses a fixed program with stdin data and an environment excluding authentication', async () => {
    vi.stubEnv('PAT_VALUE', 'DUMMY_PAT');
    vi.stubEnv('UNKNOWN_SERVICE_SECRET', 'DUMMY_UNKNOWN');
    const result = runPrepEngine(
      config,
      { yaml: 'PRIVATE_FLOW_TEXT' },
      new AbortController().signal,
      '/bundled/runner.py',
    );
    const [program, args, options] = mocks.spawn.mock.calls[0];
    expect(program).toBe(config.python);
    expect(args).toEqual(['-I', '-B', '-X', 'utf8', '/bundled/runner.py']);
    expect(options.shell).toBe(false);
    expect(
      Object.keys(options.env).every((key) =>
        ['SYSTEMROOT', 'TEMP', 'TMP'].includes(key.toUpperCase()),
      ),
    ).toBe(true);
    expect(JSON.stringify(options.env)).not.toContain('DUMMY');
    expect(child.stdin.end.mock.calls[0][0]).toContain('PRIVATE_FLOW_TEXT');
    child.stdout.emit('data', Buffer.from('{"ok":true,"valid":false,"errorCount":1}'));
    child.emit('close', 0);
    expect((await result).valid).toBe(false);
  });
  it.each(['malformed', 'nonzero', 'oversize', 'stderr'] as const)(
    'rejects %s results without exposing diagnostics',
    async (failure) => {
      const result = runPrepEngine(config, {}, new AbortController().signal, '/bundled/runner.py');
      const assertion = expect(result).rejects.not.toThrow('PRIVATE_DIAGNOSTIC');
      if (failure === 'oversize') child.stdout.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
      else if (failure === 'stderr') child.stderr.emit('data', Buffer.alloc(128 * 1024 + 1));
      else
        child.stdout.emit(
          'data',
          Buffer.from(failure === 'malformed' ? 'PRIVATE_DIAGNOSTIC' : '{"ok":true,"valid":true}'),
        );
      child.emit('close', failure === 'nonzero' ? 1 : 0);
      await assertion;
    },
  );
  it('does not spawn when already cancelled and kills an in-flight child on cancellation', async () => {
    const first = new AbortController();
    first.abort();
    await expect(runPrepEngine(config, {}, first.signal)).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
    const second = new AbortController();
    const result = runPrepEngine(config, {}, second.signal, '/bundled/runner.py');
    const assertion = expect(result).rejects.toThrow();
    second.abort();
    await assertion;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('stops a stalled engine at the fixed deadline', async () => {
    vi.useFakeTimers();
    const result = runPrepEngine(config, {}, new AbortController().signal, '/bundled/runner.py');
    const assertion = expect(result).rejects.toThrow('could not complete');
    await vi.advanceTimersByTimeAsync(60001);
    await assertion;
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
