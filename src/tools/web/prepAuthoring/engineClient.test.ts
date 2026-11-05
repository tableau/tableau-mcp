import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

import { runPrepEngine } from './engineClient.js';

const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('node:worker_threads', () => ({
  Worker: class {
    constructor(...args: unknown[]) {
      return mocks.start(...args);
    }
  },
}));

describe('isolated Node Prep worker protocol', () => {
  const config = { enabled: true, workspace: resolve('workspace') };
  let worker: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    terminate: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    worker = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      terminate: vi.fn().mockResolvedValue(0),
    });
    mocks.start.mockReturnValue(worker);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  it('uses only a bundled Node worker with data and no ambient environment/Node flags', async () => {
    vi.stubEnv('PAT_VALUE', 'DUMMY_PAT');
    vi.stubEnv('UNKNOWN_SERVICE_SECRET', 'DUMMY_UNKNOWN');
    const pending = runPrepEngine(
      config,
      { yaml: 'PRIVATE_FLOW_TEXT' },
      new AbortController().signal,
      '/bundled/worker.cjs',
    );
    const [program, options] = mocks.start.mock.calls[0];
    expect(program).toBe('/bundled/worker.cjs');
    expect(options.env).toEqual({});
    expect(options.execArgv).toEqual([]);
    expect(options.resourceLimits.maxOldGenerationSizeMb).toBe(256);
    expect(options.workerData).toEqual({ yaml: 'PRIVATE_FLOW_TEXT', workspace: config.workspace });
    worker.emit('message', { ok: true, valid: false, errorCount: 1 });
    expect((await pending).valid).toBe(false);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(['malformed', 'exit', 'oversize', 'stderr', 'error'] as const)(
    'rejects %s results without raw diagnostics',
    async (failure) => {
      const pending = runPrepEngine(
        config,
        {},
        new AbortController().signal,
        '/bundled/worker.cjs',
      );
      const assertion = expect(pending).rejects.not.toThrow('PRIVATE_DIAGNOSTIC');
      if (failure === 'oversize') worker.stdout.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
      else if (failure === 'stderr') worker.stderr.emit('data', Buffer.alloc(128 * 1024 + 1));
      else if (failure === 'exit') worker.emit('exit', 1);
      else if (failure === 'error') worker.emit('error', new Error('PRIVATE_DIAGNOSTIC'));
      else worker.emit('message', 'PRIVATE_DIAGNOSTIC');
      await assertion;
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );
  it('does not start when cancelled and terminates an in-flight worker on cancellation', async () => {
    const first = new AbortController();
    first.abort();
    await expect(runPrepEngine(config, {}, first.signal)).rejects.toThrow();
    expect(mocks.start).not.toHaveBeenCalled();
    const next = new AbortController();
    const pending = runPrepEngine(config, {}, next.signal, '/bundled/worker.cjs');
    const assertion = expect(pending).rejects.toThrow();
    next.abort();
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('terminates a stalled worker at the fixed deadline', async () => {
    vi.useFakeTimers();
    const pending = runPrepEngine(config, {}, new AbortController().signal, '/bundled/worker.cjs');
    const assertion = expect(pending).rejects.toThrow('could not complete');
    await vi.advanceTimersByTimeAsync(60001);
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
