import { resolve } from 'path';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ keyValueStore: { provider: 'memory' } })),
}));

import { type Config, getConfig } from '../config.js';
import { createNamespacedStore } from '../sessionStore/init.js';
import {
  connectKeyValueStore,
  createNamespacedKeyValueStore,
  disconnectKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from './init.js';
import type { KeyValueStore } from './keyValueStore.js';

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

  it('defaults to independent non-expiring memory stores', async () => {
    const first = createNamespacedKeyValueStore<string>('settings');
    const second = createNamespacedKeyValueStore<string>('settings');
    await first.set('key', 'value');
    await vi.advanceTimersByTimeAsync(60 * 24 * 60 * 60 * 1000);
    await expect(first.get('key')).resolves.toBe('value');
    await expect(second.get('key')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors an explicit namespace TTL on memory stores', async () => {
    const store = createNamespacedKeyValueStore<string>('temporary', { ttlMs: 1000 });
    await store.set('key', 'value');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it.each([MODULE, resolve(MODULE)])('loads a named KV provider from %s', async (module) => {
    useCustomProvider({ module, table: 'test-table' });
    initializeKeyValueStore();
    const store: KeyValueStore<string> = createNamespacedKeyValueStore('settings');
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');
    expect(globalThis.__keyValueProviderConfig).toEqual({ module, table: 'test-table' });
    // Implementing only the public storage operations requires no lifecycle hooks.
    await expect(connectKeyValueStore()).resolves.toBeUndefined();
    await expect(disconnectKeyValueStore()).resolves.toBeUndefined();
  });

  it('shares one custom backend across generic and legacy entry points', async () => {
    useCustomProvider({ module: MODULE });
    const generic = createNamespacedKeyValueStore<string>('shared');
    const legacy = createNamespacedStore<string>('shared', { ttlMs: 1000 });
    await generic.set('key', 'value');
    await expect(legacy.get('key')).resolves.toBe('value');
    await expect(legacy.consume('key')).resolves.toBe('value');
    await expect(generic.get('key')).resolves.toBeUndefined();
  });

  it('isolates namespaces and preserves atomic consumption for custom providers', async () => {
    useCustomProvider({ module: MODULE });
    const first = createNamespacedKeyValueStore<string>('first');
    const second = createNamespacedKeyValueStore<string>('second');
    await first.set('key', 'one');
    await second.set('key', 'two');
    const consumed = await Promise.all([first.consume('key'), first.consume('key')]);
    expect(consumed.filter((value) => value !== undefined)).toEqual(['one']);
    await expect(second.get('key')).resolves.toBe('two');
  });

  it('still accepts the existing default-export session-provider modules', async () => {
    useCustomProvider({ module: './src/sessionStore/__fixtures__/fakeSessionStore.cjs' });
    const store = createNamespacedKeyValueStore<string>('settings');
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');
  });

  it('rejects a provider missing required operations without falling back to memory', () => {
    useCustomProvider({ module: MODULE, omitConsume: true });
    expect(() => createNamespacedKeyValueStore('settings')).toThrow(
      'Custom provider missing required method: consume',
    );
  });

  it('propagates custom module-loading failures', () => {
    useCustomProvider({ module: './nonexistent-kv-provider.cjs' });
    expect(() => initializeKeyValueStore()).toThrow(
      /Failed to load custom key-value store provider/,
    );
  });
});
