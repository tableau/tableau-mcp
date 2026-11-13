import { resolve } from 'path';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ keyValueStore: { provider: 'memory' } })),
}));

vi.mock('../logging/logger.js', () => ({ log: vi.fn() }));

import { type Config, getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { createNamespacedStore } from '../sessionStore/init.js';
import type { KeyValueStore } from './keyValueStore.js';
import {
  connectKeyValueStore,
  createNamespacedKeyValueStore,
  disconnectKeyValueStore,
  resetKeyValueStore,
} from './storageProvider.js';

const MODULE = './src/storage/__fixtures__/keyValueStore.cjs';

declare global {
  var __keyValueProviderConfig: Record<string, unknown> | undefined;
}

function useCustomProvider(config: { module: string; [key: string]: unknown }): void {
  vi.mocked(getConfig).mockReturnValue({
    keyValueStore: { provider: 'custom', providerConfig: config },
  } as Config);
}

describe('bring-your-own KV storage', () => {
  beforeEach(() => {
    resetKeyValueStore();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ keyValueStore: { provider: 'memory' } } as Config);
    globalThis.__keyValueProviderConfig = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates independent memory stores with the supplied TTL', async () => {
    const first = createNamespacedKeyValueStore<string>('settings', { ttlMs: 1000 });
    const second = createNamespacedKeyValueStore<string>('settings', { ttlMs: 1000 });
    await first.set('key', 'value');
    await expect(first.get('key')).resolves.toBe('value');
    await expect(second.get('key')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first.get('key')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe.each(['memory', 'custom'] as const)('%s TTL validation', (provider) => {
    it.each([
      undefined,
      {},
      { ttlMs: undefined },
      { ttlMs: NaN },
      { ttlMs: Infinity },
      { ttlMs: '1000' },
    ])('rejects missing or invalid TTL options: %j', (options) => {
      if (provider === 'custom') useCustomProvider({ module: MODULE });
      expect(() =>
        Reflect.apply(createNamespacedKeyValueStore, undefined, ['settings', options]),
      ).toThrow('ttlMs must be a finite number.');
    });
  });

  it('honors an explicit namespace TTL on memory stores', async () => {
    const store = createNamespacedKeyValueStore<string>('temporary', { ttlMs: 1000 });
    await store.set('key', 'value');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it.each([MODULE, resolve(MODULE)])('loads a named KV provider from %s', async (module) => {
    useCustomProvider({ module, table: 'test-table' });
    await connectKeyValueStore();
    const store: KeyValueStore<string> = createNamespacedKeyValueStore('settings', { ttlMs: 1000 });
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');
    expect(globalThis.__keyValueProviderConfig).toEqual({ module, table: 'test-table' });
    // Implementing only the public storage operations requires no lifecycle hooks.
    await expect(connectKeyValueStore()).resolves.toBeUndefined();
    await expect(disconnectKeyValueStore()).resolves.toBeUndefined();
  });

  it('shares one custom backend across generic and legacy entry points', async () => {
    useCustomProvider({ module: MODULE });
    const generic = createNamespacedKeyValueStore<string>('shared', { ttlMs: 1000 });
    const legacy = createNamespacedStore<string>('shared', { ttlMs: 1000 });
    await generic.set('key', 'value');
    await expect(legacy.get('key')).resolves.toBe('value');
    await expect(legacy.consume('key')).resolves.toBe('value');
    await expect(generic.get('key')).resolves.toBeUndefined();
  });

  it('isolates namespaces and preserves atomic consumption for custom providers', async () => {
    useCustomProvider({ module: MODULE });
    const first = createNamespacedKeyValueStore<string>('first', { ttlMs: 1000 });
    const second = createNamespacedKeyValueStore<string>('second', { ttlMs: 1000 });
    await first.set('key', 'one');
    await second.set('key', 'two');
    const consumed = await Promise.all([first.consume('key'), first.consume('key')]);
    expect(consumed.filter((value) => value !== undefined)).toEqual(['one']);
    await expect(second.get('key')).resolves.toBe('two');
  });

  it('still accepts the existing default-export session-provider modules', async () => {
    useCustomProvider({ module: './src/sessionStore/__fixtures__/fakeSessionStore.cjs' });
    const store = createNamespacedKeyValueStore<string>('settings', { ttlMs: 1000 });
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');
  });

  it('rejects a provider missing required operations without falling back to memory', () => {
    useCustomProvider({ module: MODULE, omitConsume: true });
    expect(() => createNamespacedKeyValueStore('settings', { ttlMs: 1000 })).toThrow(
      'Custom provider missing required method: consume',
    );
  });

  it('propagates custom module-loading failures during connection', async () => {
    useCustomProvider({ module: './nonexistent-kv-provider.cjs' });
    await expect(connectKeyValueStore()).rejects.toThrow(
      /Failed to load custom key-value store provider/,
    );
  });

  it.each(['memory', 'custom'] as const)(
    'logs only lifecycle events without storage data for %s',
    async (provider) => {
      const privateMarker = 'PRIVATE_STORAGE_TEST_MARKER';
      if (provider === 'custom') {
        useCustomProvider({ module: MODULE, table: privateMarker, credential: privateMarker });
      }

      await connectKeyValueStore();
      const store = createNamespacedKeyValueStore<{ token: string }>(privateMarker, {
        ttlMs: 1000,
      });
      await store.set(privateMarker, { token: privateMarker });
      await store.get(privateMarker);
      await store.consume(privateMarker);
      await store.delete(privateMarker);
      await disconnectKeyValueStore();

      expect(log).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(vi.mocked(log).mock.calls)).not.toContain(privateMarker);
    },
  );

  it('does not log successful lifecycle events when provider hooks reject', async () => {
    useCustomProvider({
      module: './src/sessionStore/__fixtures__/rejectingLifecycleSessionStore.cjs',
    });

    await expect(connectKeyValueStore()).rejects.toThrow(/init failed/);
    await expect(disconnectKeyValueStore()).rejects.toThrow(/close failed/);

    expect(log).not.toHaveBeenCalled();
  });
});
