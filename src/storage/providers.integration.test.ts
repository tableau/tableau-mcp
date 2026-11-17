import {
  connectSessionStore,
  createNamespacedStore,
  disconnectSessionStore,
  resetSessionStore,
} from '../sessionStore/init.js';
import { stubDefaultEnvVars } from '../testShared.js';
import {
  disconnectKeyValueStore,
  getKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from './init.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';

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
  });
  afterEach(async () => {
    await disconnectSessionStore();
    await disconnectKeyValueStore();
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
    initializeKeyValueStore();
    expect(getKeyValueStore()).toBeInstanceOf(InMemoryKeyValueStore);
    const first = createNamespacedStore<string>('codes', { ttlMs: 100 });
    const second = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await first.set('key', 'session');
    await expect(second.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('codes:key')).resolves.toBeUndefined();
    await expect(second.consume('key')).resolves.toBe('session');
    await expect(first.get('key')).resolves.toBeUndefined();
  });

  it('uses independent providers and runs the SessionStore lifecycle hooks', async () => {
    vi.stubEnv('SESSION_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'SESSION_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/sessionStore/__fixtures__/lifecycleSessionStore.cjs' }),
    );
    vi.stubEnv('KV_STORE_PROVIDER', 'custom');
    vi.stubEnv(
      'KV_STORE_PROVIDER_CONFIG',
      JSON.stringify({ module: './src/storage/__fixtures__/keyValueStore.cjs', throwOnInit: true }),
    );
    await connectSessionStore();
    initializeKeyValueStore();
    expect(globalThis.__initCalls).toBe(1);
    const session = createNamespacedStore<string>('codes', { ttlMs: 100 });
    await session.set('key', 'session');
    await getKeyValueStore().set('codes:key', 'new', { ttlMs: 100 });
    await expect(session.get('key')).resolves.toBe('session');
    await expect(getKeyValueStore().get('codes:key')).resolves.toBe('new');
    await vi.advanceTimersByTimeAsync(100);
    await expect(getKeyValueStore().get('codes:key')).resolves.toBeUndefined();
    await disconnectSessionStore();
    expect(globalThis.__closeCalls).toBe(1);
    // Avoid closing the same session fixture twice in afterEach.
    resetSessionStore();
  });
});
