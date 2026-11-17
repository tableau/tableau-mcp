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
  disconnectKeyValueStore,
  getKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from './init.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';

declare global {
  var __keyValueProviderConfig: Record<string, unknown> | undefined;
  var __keyValueProviderInstance: KeyValueStore<unknown> | undefined;
}

const MODULE = './src/storage/__fixtures__/keyValueStore.cjs';

function useCustomProvider(options: Record<string, unknown> = {}): void {
  vi.mocked(getConfig).mockReturnValue({
    keyValueStore: { provider: 'custom', providerConfig: { module: MODULE, ...options } },
    sessionStore: { provider: 'memory' },
  } as Config);
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
  });
  afterEach(async () => {
    await disconnectKeyValueStore();
    vi.useRealTimers();
  });

  it('requires initialization and never loads a provider from the getter', () => {
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('returns one actual memory implementation and preserves it on repeated initialization', async () => {
    initializeKeyValueStore();
    const store = getKeyValueStore();
    expect(store).toBeInstanceOf(InMemoryKeyValueStore);
    await store.set('unprefixed', 'value', { ttlMs: 1000 });
    initializeKeyValueStore();
    expect(getKeyValueStore()).toBe(store);
    expect(getConfig).toHaveBeenCalledOnce();
    await expect(getKeyValueStore().get('unprefixed')).resolves.toBe('value');
  });

  it.each([MODULE, resolve(MODULE), './src/storage/__fixtures__/defaultKeyValueStore.cjs'])(
    'constructs the actual custom implementation from %s and forwards configuration',
    async (module) => {
      useCustomProvider({ module, table: 'kv-table', throwOnInit: true });
      initializeKeyValueStore();
      expect(getKeyValueStore()).toBe(globalThis.__keyValueProviderInstance);
      expect(globalThis.__keyValueProviderConfig).toEqual({
        module,
        table: 'kv-table',
        throwOnInit: true,
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
      initializeKeyValueStore();
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
    initializeKeyValueStore();
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
    initializeKeyValueStore();
    await initializeSessionStore();
    const session = createNamespacedStore<string>('settings', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('settings:key', 'kv', { ttlMs: 100 });
    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('settings:key')).resolves.toBe('kv');
  });

  it.each(['module', 'constructor'] as const)(
    'sanitizes %s failures and never falls back to memory',
    (failure) => {
      const marker = 'PRIVATE_KV_TEST_MARKER';
      useCustomProvider({
        module: failure === 'module' ? `./${marker}.cjs` : MODULE,
        throwInConstructor: failure === 'constructor',
        credential: marker,
      });
      let caught: unknown;
      try {
        initializeKeyValueStore();
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

  it('rejects a provider missing a required operation', () => {
    useCustomProvider({ omitConsume: true });
    expect(() => initializeKeyValueStore()).toThrow(
      'Failed to load custom key-value store provider',
    );
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it('requires a default or named KeyValueStore export', () => {
    useCustomProvider({ module: './src/sessionStore/__fixtures__/namedSessionStore.cjs' });
    expect(() => initializeKeyValueStore()).toThrow(
      'Failed to load custom key-value store provider',
    );
  });

  it('cleans up memory data and timers and makes the getter unavailable on shutdown', async () => {
    initializeKeyValueStore();
    await getKeyValueStore().set('key', 'value', { ttlMs: 1000 });
    await disconnectKeyValueStore();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
  });

  it('retains a provider when cleanup fails and does not log shutdown success', async () => {
    useCustomProvider({ rejectClose: true });
    initializeKeyValueStore();
    const store = getKeyValueStore();
    vi.mocked(log).mockClear();
    await expect(disconnectKeyValueStore()).rejects.toThrow('close failed');
    expect(getKeyValueStore()).toBe(store);
    expect(log).not.toHaveBeenCalled();
    // Allow afterEach to release this test fixture.
    useCustomProvider();
    resetKeyValueStore();
  });

  it('does not log keys, values, or configuration', async () => {
    const marker = 'PRIVATE_KV_DATA';
    useCustomProvider({ credential: marker });
    initializeKeyValueStore();
    await getKeyValueStore().set(marker, marker, { ttlMs: 100 });
    await getKeyValueStore().consume(marker);
    await disconnectKeyValueStore();
    expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(marker);
  });
});
