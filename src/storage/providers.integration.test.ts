import { resolve } from 'path';

import {
  connectSessionStore,
  createNamespacedStore,
  disconnectSessionStore,
  resetSessionStore,
} from '../sessionStore/init.js';
import { stubDefaultEnvVars } from '../testShared.js';
import {
  closeKeyValueStore,
  getKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from './init.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import { setupTestKeyValueStore } from './testUtils.js';

const MODULE = './src/storage/__fixtures__/keyValueStore.cjs';

// Real Config/env parsing and real module loaders; no mocked storage wiring.
describe('session and KV environment configuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubDefaultEnvVars();
    for (const name of [
      'SESSION_STORE_PROVIDER',
      'SESSION_STORE_PROVIDER_CONFIG',
      'KV_STORE_PROVIDER',
      'KV_STORE_PROVIDER_CONFIG',
    ])
      vi.stubEnv(name, undefined);
    resetKeyValueStore();
    resetSessionStore();
    globalThis.__initCalls = 0;
    globalThis.__closeCalls = 0;
    globalThis.__keyValueInitCalls = 0;
    globalThis.__keyValueCloseCalls = 0;
    globalThis.__keyValueProviderConfig = undefined;
    globalThis.__keyValueProviderInstance = undefined;
  });
  afterEach(async () => {
    await disconnectSessionStore();
    await closeKeyValueStore();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('loads a custom SessionStore from SESSION_STORE settings', async () => {
    vi.stubEnv('SESSION_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'SESSION_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/storage/__fixtures__/sessionStore.cjs' }),
    );
    await connectSessionStore();
    await initializeKeyValueStore();
    expect(getKeyValueStore()).toBeInstanceOf(InMemoryKeyValueStore);
    const first = createNamespacedStore<string>('codes', { ttlMs: 100 });
    const second = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await first.set('key', 'session');
    await expect(second.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('codes:key')).resolves.toBeUndefined();
    await expect(second.consume('key')).resolves.toBe('session');
    await expect(first.get('key')).resolves.toBeUndefined();
  });

  it("uses independent providers and runs both providers' lifecycle hooks", async () => {
    vi.stubEnv('SESSION_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'SESSION_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/sessionStore/__fixtures__/lifecycleSessionStore.cjs' }),
    );
    vi.stubEnv('KV_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'KV_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/storage/__fixtures__/keyValueStore.cjs', lifecycle: true }),
    );
    await connectSessionStore();
    await initializeKeyValueStore();
    expect(globalThis.__initCalls).toBe(1);
    expect(globalThis.__keyValueInitCalls).toBe(1);
    const session = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('codes:key', 'new', { ttlMs: 100 });
    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('codes:key')).resolves.toBe('new');
    await vi.advanceTimersByTimeAsync(100);
    await expect(getKeyValueStore().get('codes:key')).resolves.toBeUndefined();
    await disconnectSessionStore();
    await closeKeyValueStore();
    expect(globalThis.__closeCalls).toBe(1);
    expect(globalThis.__keyValueCloseCalls).toBe(1);
    // Avoid closing the same session fixture twice in afterEach.
    resetSessionStore();
  });

  it.each([MODULE, resolve(MODULE), './src/storage/__fixtures__/defaultKeyValueStore.cjs'])(
    'constructs the actual custom implementation from %s and forwards configuration',
    async (module) => {
      vi.stubEnv('KV_STORE_PROVIDER', 'custom');
      vi.stubEnv('KV_STORE_PROVIDER_CONFIG', JSON.stringify({ module, table: 'kv-table' }));
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
      vi.stubEnv('KV_STORE_PROVIDER', provider);
      if (provider === 'custom') {
        vi.stubEnv('KV_STORE_PROVIDER_CONFIG', JSON.stringify({ module: MODULE }));
      }
      await setupTestKeyValueStore();
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
    await connectSessionStore();
    await setupTestKeyValueStore();
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

  it('starts repeated test setup with a fresh, empty memory store', async () => {
    await setupTestKeyValueStore();
    const previous = getKeyValueStore();
    await previous.set('key', 'previous test', { ttlMs: 100 });

    await setupTestKeyValueStore();

    expect(getKeyValueStore()).not.toBe(previous);
    await expect(getKeyValueStore().get('key')).resolves.toBeUndefined();
  });

  it('uses independently configured custom session and KV providers', async () => {
    vi.stubEnv('KV_STORE_PROVIDER', 'custom');
    vi.stubEnv('KV_STORE_PROVIDER_CONFIG', JSON.stringify({ module: MODULE }));
    vi.stubEnv('SESSION_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'SESSION_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/sessionStore/__fixtures__/fakeSessionStore.cjs' }),
    );
    await initializeKeyValueStore();
    await connectSessionStore();
    const session = createNamespacedStore<string>('settings', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('settings:key', 'kv', { ttlMs: 100 });
    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('settings:key')).resolves.toBe('kv');
  });
});
