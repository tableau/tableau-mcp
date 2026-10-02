import type { Config } from '../config.js';
import { initializeFeatureGate } from '../features/init.js';
import { getTableauServerInfo } from '../getTableauServerInfo.js';
import { log } from '../logging/logger.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import {
  connectSessionStore,
  disconnectSessionStore,
  initializeSessionStore,
} from '../sessionStore/init.js';

const runtimeState = vi.hoisted(() => ({
  events: [] as string[],
  connectPromise: Promise.resolve(),
  disconnectShouldReject: false,
  serverInfoPromise: Promise.resolve({}),
  shutdownHandlers: new Map<string, () => Promise<void>>(),
}));

vi.mock('../features/init.js', () => ({
  initializeFeatureGate: vi.fn(() => {
    runtimeState.events.push('feature gate');
  }),
}));

vi.mock('../getTableauServerInfo.js', () => ({
  getTableauServerInfo: vi.fn(() => {
    runtimeState.events.push('server info');
    return runtimeState.serverInfoPromise;
  }),
}));

vi.mock('../logging/logger.js', () => ({
  log: vi.fn(),
}));

vi.mock('../sdks/tableau/restApi.js', () => ({
  RestApi: { host: '' },
}));

vi.mock('../sessionStore/init.js', () => ({
  initializeSessionStore: vi.fn(() => {
    runtimeState.events.push('session store init');
  }),
  connectSessionStore: vi.fn(() => {
    runtimeState.events.push('session store connect');
    return runtimeState.connectPromise;
  }),
  disconnectSessionStore: vi.fn(async () => {
    if (runtimeState.disconnectShouldReject) {
      throw new Error('session store close failed');
    }
  }),
}));

import { initializeWebRuntime } from './webRuntime.js';

function deferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const config = { server: 'https://tableau.example.com' } as Config;

describe('initializeWebRuntime', () => {
  let processOnceSpy: { mockRestore(): void };
  let processExitSpy: { mockRestore(): void };

  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.events = [];
    runtimeState.connectPromise = Promise.resolve();
    runtimeState.disconnectShouldReject = false;
    runtimeState.serverInfoPromise = Promise.resolve({});
    runtimeState.shutdownHandlers.clear();
    RestApi.host = '';
    processOnceSpy = vi.spyOn(process, 'once').mockImplementation(((signal, listener) => {
      runtimeState.shutdownHandlers.set(String(signal), listener as () => Promise<void>);
      return process;
    }) as typeof process.once);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    processOnceSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('connects providers before starting server info and returns its pending readiness', async () => {
    const connect = deferred<void>();
    const serverInfo = deferred<object>();
    runtimeState.connectPromise = connect.promise;
    runtimeState.serverInfoPromise = serverInfo.promise;

    const runtimePromise = initializeWebRuntime(config);
    await vi.waitFor(() => expect(connectSessionStore).toHaveBeenCalledOnce());

    expect(RestApi.host).toBe(config.server);
    expect(runtimeState.events).toEqual([
      'feature gate',
      'session store init',
      'session store connect',
    ]);
    expect(getTableauServerInfo).not.toHaveBeenCalled();
    expect(processOnceSpy).not.toHaveBeenCalled();

    connect.resolve();
    const { serverInfoReady } = await runtimePromise;

    expect(runtimeState.events).toEqual([
      'feature gate',
      'session store init',
      'session store connect',
      'server info',
    ]);
    expect(processOnceSpy).toHaveBeenCalledTimes(2);
    expect(runtimeState.shutdownHandlers.size).toBe(2);

    let ready = false;
    void serverInfoReady.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    serverInfo.resolve({});
    await serverInfoReady;
    expect(ready).toBe(true);
  });

  it('fails before registering handlers or fetching server info when the store cannot connect', async () => {
    runtimeState.connectPromise = Promise.reject(new Error('session store init failed'));

    await expect(initializeWebRuntime(config)).rejects.toThrow('session store init failed');

    expect(initializeFeatureGate).toHaveBeenCalledOnce();
    expect(initializeSessionStore).toHaveBeenCalledOnce();
    expect(getTableauServerInfo).not.toHaveBeenCalled();
    expect(processOnceSpy).not.toHaveBeenCalled();
  });

  it('logs and exits when server info fails', async () => {
    const serverInfo = deferred<object>();
    runtimeState.serverInfoPromise = serverInfo.promise;
    const { serverInfoReady } = await initializeWebRuntime(config);
    const failure = new Error('server info failed');

    serverInfo.reject(failure);
    await serverInfoReady;

    expect(log).toHaveBeenCalledWith({
      message: 'Fatal error initializing server info',
      level: 'error',
      logger: 'startup',
      data: failure,
    });
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('exits zero after disconnect and exits one when disconnect fails', async () => {
    const { serverInfoReady } = await initializeWebRuntime(config);
    await serverInfoReady;

    await runtimeState.shutdownHandlers.get('SIGINT')!();
    expect(disconnectSessionStore).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenLastCalledWith(0);

    runtimeState.disconnectShouldReject = true;
    await runtimeState.shutdownHandlers.get('SIGTERM')!();
    expect(disconnectSessionStore).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Error closing session store during shutdown',
        level: 'error',
        logger: 'shutdown',
      }),
    );
    expect(processExitSpy).toHaveBeenLastCalledWith(1);
  });
});
