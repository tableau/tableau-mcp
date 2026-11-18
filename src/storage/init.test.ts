import { inspect } from 'node:util';

import { resolve } from 'path';

vi.mock('../config.js', () => ({ getConfig: vi.fn() }));
vi.mock('../logging/logger.js', () => ({ log: vi.fn() }));

import { type Config, getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import {
  createNamespacedStore,
  initializeSessionStore,
  resetSessionStore,
} from '../sessionStore/init.js';
import {
  closeKeyValueStore,
  getKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from './init.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';

declare global {
  var __keyValueProviderConfig: Record<string, unknown> | undefined;
  var __keyValueProviderInstance: KeyValueStore<unknown> | undefined;
  var __keyValueInitCalls: number;
  var __keyValueCloseCalls: number;
}

const MODULE = './src/storage/__fixtures__/keyValueStore.cjs';

function useCustomProvider(options: Record<string, unknown> = {}): void {
  vi.mocked(getConfig).mockReturnValue({
    keyValueStore: { provider: 'custom', providerConfig: { module: MODULE, ...options } },
    sessionStore: { provider: 'memory' },
  } as Config);
}

function useLifecycleProvider(options: Record<string, unknown> = {}): void {
  useCustomProvider({ lifecycle: true, ...options });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('independent KV provider', () => {
  beforeEach(() => {
    resetKeyValueStore();
    resetSessionStore();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(getConfig).mockReturnValue({
      keyValueStore: { provider: 'memory' },
      sessionStore: { provider: 'memory' },
    } as Config);
    globalThis.__keyValueProviderConfig = undefined;
    globalThis.__keyValueProviderInstance = undefined;
    globalThis.__keyValueInitCalls = 0;
    globalThis.__keyValueCloseCalls = 0;
  });
  afterEach(async () => {
    await closeKeyValueStore();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('requires initialization and never loads a provider from the getter', () => {
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('returns one actual memory implementation and preserves it on repeated initialization', async () => {
    await initializeKeyValueStore();
    const store = getKeyValueStore();
    expect(store).toBeInstanceOf(InMemoryKeyValueStore);
    await store.set('unprefixed', 'value', { ttlMs: 1000 });
    await initializeKeyValueStore();
    expect(getKeyValueStore()).toBe(store);
    expect(getConfig).toHaveBeenCalledOnce();
    await expect(getKeyValueStore().get('unprefixed')).resolves.toBe('value');
  });

  it.each([MODULE, resolve(MODULE), './src/storage/__fixtures__/defaultKeyValueStore.cjs'])(
    'constructs the actual custom implementation from %s and forwards configuration',
    async (module) => {
      useCustomProvider({ module, table: 'kv-table' });
      await initializeKeyValueStore();
      expect(getKeyValueStore()).toBe(globalThis.__keyValueProviderInstance);
      expect(globalThis.__keyValueProviderConfig).toEqual({
        module,
        table: 'kv-table',
      });
      await getKeyValueStore().set('key', { value: 1 }, { ttlMs: 100 });
      await expect(getKeyValueStore().get('key')).resolves.toEqual({ value: 1 });
      await vi.advanceTimersByTimeAsync(100);
      await expect(getKeyValueStore().get('key')).resolves.toBeUndefined();
    },
  );

  it.each(['memory', 'custom'] as const)(
    'supports atomic consume with %s storage',
    async (provider) => {
      if (provider === 'custom') useCustomProvider();
      await initializeKeyValueStore();
      const store = getKeyValueStore();
      await store.set('a:b:c', 'value', { ttlMs: 100 });
      expect(await Promise.all([store.consume('a:b:c'), store.consume('a:b:c')])).toEqual([
        'value',
        undefined,
      ]);
      await expect(store.delete('missing')).resolves.toBeUndefined();
    },
  );

  it('keeps session memory handles independent from each other and KV storage', async () => {
    await initializeSessionStore();
    await initializeKeyValueStore();
    const first = createNamespacedStore<string>('settings', { ttlMs: 100 });
    const second = createNamespacedStore<string>('settings', { ttlMs: 200 });
    await first.set('key', 'session');
    await getKeyValueStore().set('settings:key', 'kv', { ttlMs: 300 });
    await expect(first.get('key')).resolves.toBe('session');
    await expect(second.get('key')).resolves.toBeUndefined();
    await expect(getKeyValueStore().get('settings:key')).resolves.toBe('kv');
    await vi.advanceTimersByTimeAsync(100);
    await expect(first.get('key')).resolves.toBeUndefined();
    await expect(getKeyValueStore().get('settings:key')).resolves.toBe('kv');
  });

  it('uses independently configured custom session and KV providers', async () => {
    useCustomProvider();
    const config = vi.mocked(getConfig)();
    config.sessionStore = {
      provider: 'custom',
      providerConfig: { module: './src/sessionStore/__fixtures__/fakeSessionStore.cjs' },
    };
    await initializeKeyValueStore();
    await initializeSessionStore();
    const session = createNamespacedStore<string>('settings', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('settings:key', 'kv', { ttlMs: 100 });
    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('settings:key')).resolves.toBe('kv');
  });

  it.each(['module', 'constructor'] as const)(
    'sanitizes %s failures and never falls back to memory',
    async (failure) => {
      const marker = 'PRIVATE_KV_TEST_MARKER';
      useCustomProvider({
        module: failure === 'module' ? `./${marker}.cjs` : MODULE,
        throwInConstructor: failure === 'constructor',
        credential: marker,
      });
      let caught: unknown;
      try {
        await initializeKeyValueStore();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).toHaveProperty(
        'message',
        'Failed to load custom key-value store provider. Check its module export and configuration.',
      );
      expect(inspect(caught)).not.toContain(marker);
      expect(caught).not.toHaveProperty('cause');
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
      expect(log).not.toHaveBeenCalled();
    },
  );

  it('rejects a provider missing a required operation', async () => {
    useCustomProvider({ omitConsume: true });
    await expect(initializeKeyValueStore()).rejects.toThrow(
      'Failed to load custom key-value store provider',
    );
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it('requires a default or named KeyValueStore export', async () => {
    useCustomProvider({ module: './src/storage/__fixtures__/sessionStore.cjs' });
    await expect(initializeKeyValueStore()).rejects.toThrow(
      'Failed to load custom key-value store provider',
    );
  });

  it('does not log keys, values, or configuration', async () => {
    const marker = 'PRIVATE_KV_DATA';
    useCustomProvider({ credential: marker });
    await initializeKeyValueStore();
    await getKeyValueStore().set(marker, marker, { ttlMs: 100 });
    await getKeyValueStore().consume(marker);
    expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(marker);
  });

  it('awaits init and shares one provider across concurrent and repeated initialization', async () => {
    const ready = deferred();
    const initHook = vi.fn(() => ready.promise);
    useLifecycleProvider({ initHook });

    const first = initializeKeyValueStore();
    const second = initializeKeyValueStore();
    expect(second).toBe(first);
    expect(initHook).toHaveBeenCalledOnce();
    expect(getConfig).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');

    ready.resolve();
    await Promise.all([first, second]);
    expect(getKeyValueStore()).toBe(globalThis.__keyValueProviderInstance);
    await initializeKeyValueStore();
    expect(initHook).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
  });

  it('supports synchronous initialization', async () => {
    const initHook = vi.fn();
    useLifecycleProvider({ initHook });
    await initializeKeyValueStore();
    expect(initHook).toHaveBeenCalledOnce();
    expect(getKeyValueStore()).toBe(globalThis.__keyValueProviderInstance);
  });

  it.each(['sync', 'async'] as const)('sanitizes %s initialization failures', async (mode) => {
    const marker = 'PRIVATE_KV_INIT_CREDENTIAL';
    const initHook = (): void | Promise<void> => {
      const failure = new Error(marker, { cause: new Error(marker) });
      if (mode === 'sync') throw failure;
      return Promise.reject(failure);
    };
    useLifecycleProvider({ initHook });

    const failure = await initializeKeyValueStore().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty(
      'message',
      'Failed to initialize key-value store provider. Check its backend and configuration.',
    );
    expect(inspect(failure)).not.toContain(marker);
    expect(failure).not.toHaveProperty('cause');
    expect(log).not.toHaveBeenCalled();
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it('allows retrying initialization after a failed attempt', async () => {
    const initHook = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(undefined);
    useLifecycleProvider({ initHook });
    await expect(initializeKeyValueStore()).rejects.toThrow('Failed to initialize');
    await initializeKeyValueStore();
    expect(initHook).toHaveBeenCalledTimes(2);
    expect(getKeyValueStore()).toBe(globalThis.__keyValueProviderInstance);
  });

  it.each(['initHook', 'closeHook'])('rejects a non-function %s', async (hook) => {
    useLifecycleProvider({ [hook]: true });
    await expect(initializeKeyValueStore()).rejects.toThrow(
      'Failed to load custom key-value store provider',
    );
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it.each(['sync', 'async'] as const)(
    'runs %s cleanup once across repeated calls',
    async (mode) => {
      const closeHook = vi.fn(() => (mode === 'async' ? Promise.resolve() : undefined));
      useLifecycleProvider({ closeHook });
      await initializeKeyValueStore();
      await Promise.all([closeKeyValueStore(), closeKeyValueStore()]);
      await closeKeyValueStore();
      expect(closeHook).toHaveBeenCalledOnce();
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
    },
  );

  it('waits for initialization before closing the provider', async () => {
    const ready = deferred();
    const closeHook = vi.fn();
    useLifecycleProvider({ initHook: () => ready.promise, closeHook });
    const initializing = initializeKeyValueStore();
    const closed = closeKeyValueStore();
    expect(closeHook).not.toHaveBeenCalled();
    ready.resolve();
    await Promise.all([initializing, closed]);
    expect(closeHook).toHaveBeenCalledOnce();
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it('finishes closing the old provider before constructing a replacement', async () => {
    const closed = deferred();
    const closeHook = vi.fn(() => closed.promise);
    useLifecycleProvider({ closeHook });
    await initializeKeyValueStore();
    const firstProvider = getKeyValueStore();
    const closing = closeKeyValueStore();
    const initializing = initializeKeyValueStore();
    await Promise.resolve();
    expect(closeHook).toHaveBeenCalledOnce();
    expect(getConfig).toHaveBeenCalledOnce();
    closed.resolve();
    await Promise.all([closing, initializing]);
    expect(getKeyValueStore()).not.toBe(firstProvider);
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it.each(['sync', 'async'] as const)('sanitizes %s cleanup failures', async (mode) => {
    const marker = 'PRIVATE_KV_CLOSE_CREDENTIAL';
    const closeHook = (): void | Promise<void> => {
      const failure = new Error(marker, { cause: new Error(marker) });
      if (mode === 'sync') throw failure;
      return Promise.reject(failure);
    };
    useLifecycleProvider({ closeHook });
    await initializeKeyValueStore();
    const failure = await closeKeyValueStore().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty('message', 'Failed to close key-value store provider.');
    expect(inspect(failure)).not.toContain(marker);
    expect(failure).not.toHaveProperty('cause');
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it('closing an uninitialized provider does not construct one', async () => {
    await closeKeyValueStore();
    expect(getConfig).not.toHaveBeenCalled();
  });
});
