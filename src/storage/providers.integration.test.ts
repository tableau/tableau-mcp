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

declare global {
  var __keyValueProviderConfig: Record<string, unknown> | undefined;
  var __keyValueInitCalls: number;
  var __keyValueCloseCalls: number;
}

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
      JSON.stringify({ module: './src/sessionStore/__fixtures__/fakeSessionStore.cjs' }),
    );
    await connectSessionStore();
    await initializeKeyValueStore();
    expect(getKeyValueStore()).toBeInstanceOf(InMemoryKeyValueStore);
    const session = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await session.set('key', 'session');
    const sameNamespace = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await expect(sameNamespace.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('codes:key')).resolves.toBeUndefined();
  });

  it("uses independent providers and runs both providers' lifecycle hooks", async () => {
    vi.stubEnv('SESSION_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'SESSION_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/sessionStore/__fixtures__/lifecycleSessionStore.cjs' }),
    );
    vi.stubEnv('KV_STORE_PROVIDER', 'custom');
    vi.stubEnv('KV_STORE_PROVIDER_CONFIG', JSON.stringify({ module: MODULE }));
    await connectSessionStore();
    await initializeKeyValueStore();
    expect(globalThis.__initCalls).toBe(1);
    expect(globalThis.__keyValueInitCalls).toBe(1);
    const session = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('codes:key', 'new', { ttlMs: 100 });
    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('codes:key')).resolves.toBe('new');
    await disconnectSessionStore();
    await closeKeyValueStore();
    expect(globalThis.__closeCalls).toBe(1);
    expect(globalThis.__keyValueCloseCalls).toBe(1);
    // Avoid closing the same session fixture twice in afterEach.
    resetSessionStore();
  });

  it('loads an absolute KV module path and passes its environment config to the provider', async () => {
    const config = { module: resolve(MODULE), table: 'kv-table' };
    vi.stubEnv('KV_STORE_PROVIDER', 'custom');
    vi.stubEnv('KV_STORE_PROVIDER_CONFIG', JSON.stringify(config));

    await initializeKeyValueStore();

    expect(globalThis.__keyValueProviderConfig).toEqual(config);
  });

  it('keeps the default session and KV stores independent', async () => {
    await connectSessionStore();
    await initializeKeyValueStore();
    const session = createNamespacedStore<string>('settings', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('settings:key', 'kv', { ttlMs: 100 });

    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('settings:key')).resolves.toBe('kv');
  });
});
