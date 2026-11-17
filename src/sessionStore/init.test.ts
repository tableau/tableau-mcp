import { inspect } from 'node:util';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logging/logger.js', () => ({ log: vi.fn() }));

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    sessionStore: { provider: 'memory' },
  })),
}));

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import {
  connectSessionStore,
  createNamespacedStore,
  disconnectSessionStore,
  initializeSessionStore,
  resetSessionStore,
} from './init.js';
import type { SessionStore } from './sessionStore.js';
import { isSessionStoreProvider, sessionStoreProviderSchema } from './types.js';

const FAKE_STORE_MODULE = './src/sessionStore/__fixtures__/fakeSessionStore.cjs';
const CONFIGURE_NAMESPACE_STORE_MODULE =
  './src/sessionStore/__fixtures__/configureNamespaceSessionStore.cjs';
const LIFECYCLE_STORE_MODULE = './src/sessionStore/__fixtures__/lifecycleSessionStore.cjs';
const REJECTING_LIFECYCLE_STORE_MODULE =
  './src/sessionStore/__fixtures__/rejectingLifecycleSessionStore.cjs';

// The fixture providers are instantiated inside init.ts's loader, out of the test's reach, so they
// record their configureNamespace / init / close calls here on globalThis for the test to assert.
declare global {
  var __configureNamespaceCalls: Array<{ namespace: string; options: unknown }> | undefined;
  var __initCalls: number | undefined;
  var __closeCalls: number | undefined;
}

describe('SessionStore init', () => {
  beforeEach(() => {
    resetSessionStore();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ sessionStore: { provider: 'memory' } } as any);
    globalThis.__initCalls = 0;
    globalThis.__closeCalls = 0;
  });

  describe('provider selection', () => {
    it('defaults to the memory provider when unconfigured', async () => {
      await initializeSessionStore();
      const store = createNamespacedStore<string>('ns', { ttlMs: 10000 });
      await store.set('key', 'value');
      await expect(store.get('key')).resolves.toBe('value');
    });

    it('loads a custom provider successfully from a fixture module', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: FAKE_STORE_MODULE },
        },
      } as any);

      await initializeSessionStore();
      const store = createNamespacedStore<string>('ns', { ttlMs: 10000 });

      await store.set('key', 'value');
      await expect(store.get('key')).resolves.toBe('value');

      // Proves the custom backend (not the memory fallback) is in use: two calls for the same
      // namespace share the one loaded provider, whereas the memory path returns fresh instances.
      const second = createNamespacedStore<string>('ns', { ttlMs: 10000 });
      await expect(second.get('key')).resolves.toBe('value');
    });

    it('rejects when the custom module is missing "module"', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: { provider: 'custom', providerConfig: {} },
      } as any);

      // Fail closed: an explicitly-configured custom store that cannot load must be fatal at
      // boot, not silently downgraded to isolated in-memory state on every replica.
      await expect(initializeSessionStore()).rejects.toThrow(/"module"/);
    });

    it('rejects when the custom module fails to load', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: './nonexistent-provider.cjs' },
        },
      } as any);

      await expect(initializeSessionStore()).rejects.toThrow(
        /Failed to load custom session store provider/,
      );
    });

    it('propagates the original error when getConfig throws', async () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      // The raw error must propagate uncaught (not wrapped or swallowed), so the existing
      // top-level fatal-boot handler in index.ts logs it and exits.
      await expect(initializeSessionStore()).rejects.toThrow('Config error');
    });
  });

  describe('createNamespacedStore', () => {
    it('returns independent stores for the same namespace on the memory path', async () => {
      await initializeSessionStore();
      const a = createNamespacedStore<string>('ns', { ttlMs: 10000 });
      const b = createNamespacedStore<string>('ns', { ttlMs: 10000 });

      await a.set('key', 'value');
      await expect(a.get('key')).resolves.toBe('value');
      await expect(b.get('key')).resolves.toBeUndefined();
    });

    it('requires initialization before creating a store', () => {
      expect(() => createNamespacedStore('ns', { ttlMs: 10000 })).toThrow(
        'Session store is not initialized.',
      );
      expect(getConfig).not.toHaveBeenCalled();
    });

    it('isolates identical raw keys across namespaces sharing one custom backend', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: FAKE_STORE_MODULE },
        },
      } as any);

      await initializeSessionStore();

      const nsA = createNamespacedStore<string>('alpha', { ttlMs: 10000 });
      const nsB = createNamespacedStore<string>('beta', { ttlMs: 10000 });

      await nsA.set('shared', 'a-value');
      await nsB.set('shared', 'b-value');

      // Prefixing keeps the identical raw key 'shared' from colliding on the shared backend.
      await expect(nsA.get('shared')).resolves.toBe('a-value');
      await expect(nsB.get('shared')).resolves.toBe('b-value');

      // delete/set on one namespace prefixes both keys and does not disturb the other.
      await nsA.delete('shared');
      await nsA.set('rotated', 'a-rotated');
      await expect(nsA.get('shared')).resolves.toBeUndefined();
      await expect(nsA.get('rotated')).resolves.toBe('a-rotated');
      await expect(nsB.get('shared')).resolves.toBe('b-value');
    });

    it('forwards each namespace its own TTL/bound via configureNamespace on the custom path', async () => {
      globalThis.__configureNamespaceCalls = [];
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: CONFIGURE_NAMESPACE_STORE_MODULE },
        },
      } as any);

      await initializeSessionStore();

      createNamespacedStore<string>('alpha', { ttlMs: 1000, maxSize: 500 });
      createNamespacedStore<string>('beta', { ttlMs: 2000 });

      // Each namespace's own options reach its own call, with no cross-namespace conflation.
      expect(globalThis.__configureNamespaceCalls).toEqual([
        { namespace: 'alpha', options: { ttlMs: 1000, maxSize: 500 } },
        { namespace: 'beta', options: { ttlMs: 2000 } },
      ]);
    });

    it('works with a custom provider that does not implement configureNamespace', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: FAKE_STORE_MODULE },
        },
      } as any);

      await initializeSessionStore();

      // The optional `?.()` call is a no-op when absent: wrapping and normal ops still work.
      const store = createNamespacedStore<string>('ns', { ttlMs: 10000 });
      await store.set('key', 'value');
      await expect(store.get('key')).resolves.toBe('value');
    });
  });

  describe('custom session providers', () => {
    function useCustomStore(module: string, options: Record<string, unknown> = {}): void {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: { provider: 'custom', providerConfig: { module, ...options } },
      } as any);
    }

    it('uses an custom provider with the two-argument set contract', async () => {
      useCustomStore(FAKE_STORE_MODULE);
      await initializeSessionStore();

      const sessions: SessionStore<{ userId: string }> = createNamespacedStore('sessions', {
        ttlMs: 10000,
      });
      const proofs: SessionStore<string> = createNamespacedStore('proofs', {
        ttlMs: 1000,
      });

      await sessions.set('same-key', { userId: 'user-1' });
      await proofs.set('same-key', 'proof');
      await expect(sessions.get('same-key')).resolves.toEqual({ userId: 'user-1' });
      await expect(proofs.consume('same-key')).resolves.toBe('proof');
      await expect(sessions.get('same-key')).resolves.toEqual({ userId: 'user-1' });
    });
  });

  describe('lifecycle hooks', () => {
    function useCustomStore(module: string, options: Record<string, unknown> = {}): void {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: { provider: 'custom', providerConfig: { module, ...options } },
      } as any);
    }

    it('connectSessionStore calls a custom provider that implements init()', async () => {
      useCustomStore(LIFECYCLE_STORE_MODULE);
      await connectSessionStore();
      expect(globalThis.__initCalls).toBe(1);
    });

    it('session lifecycle functions share the same initializer and only initialize once', async () => {
      useCustomStore(LIFECYCLE_STORE_MODULE);
      await initializeSessionStore();
      await connectSessionStore();
      expect(globalThis.__initCalls).toBe(1);
    });

    it('connectSessionStore propagates a rejecting init() (fail-closed)', async () => {
      useCustomStore(REJECTING_LIFECYCLE_STORE_MODULE);
      await expect(connectSessionStore()).rejects.toThrow(/init failed/);
    });

    it('connectSessionStore resolves cleanly when the custom provider has no init()', async () => {
      useCustomStore(FAKE_STORE_MODULE);
      await expect(connectSessionStore()).resolves.toBeUndefined();
    });

    it('connectSessionStore is a no-op on the memory path', async () => {
      await expect(connectSessionStore()).resolves.toBeUndefined();
      expect(globalThis.__initCalls).toBe(0);
    });

    it('disconnectSessionStore calls a custom provider that implements close()', async () => {
      useCustomStore(LIFECYCLE_STORE_MODULE);
      await initializeSessionStore();
      await disconnectSessionStore();
      expect(globalThis.__closeCalls).toBe(1);
    });

    it('disconnectSessionStore propagates a rejecting close()', async () => {
      useCustomStore(REJECTING_LIFECYCLE_STORE_MODULE, { rejectInit: false });
      await initializeSessionStore();
      await expect(disconnectSessionStore()).rejects.toThrow(/close failed/);
    });

    it('disconnectSessionStore resolves cleanly when the custom provider has no close()', async () => {
      useCustomStore(FAKE_STORE_MODULE);
      await initializeSessionStore();
      await expect(disconnectSessionStore()).resolves.toBeUndefined();
    });

    it('disconnectSessionStore is a no-op on the memory path (including uninitialized)', async () => {
      // state === null (never initialized) and the memory path both resolve without touching a store.
      await expect(disconnectSessionStore()).resolves.toBeUndefined();
      await initializeSessionStore();
      await expect(disconnectSessionStore()).resolves.toBeUndefined();
      expect(globalThis.__closeCalls).toBe(0);
    });
  });

  describe('Session Store Provider Types', () => {
    describe('sessionStoreProviderSchema', () => {
      it('accepts "memory" as a valid provider', () => {
        expect(sessionStoreProviderSchema.safeParse('memory').success).toBe(true);
      });

      it('accepts "custom" as a valid provider', () => {
        expect(sessionStoreProviderSchema.safeParse('custom').success).toBe(true);
      });

      it('rejects invalid provider values', () => {
        expect(sessionStoreProviderSchema.safeParse('invalid').success).toBe(false);
      });
    });

    describe('isSessionStoreProvider', () => {
      it('returns true for valid providers', () => {
        expect(isSessionStoreProvider('memory')).toBe(true);
        expect(isSessionStoreProvider('custom')).toBe(true);
      });

      it('returns false for invalid values', () => {
        expect(isSessionStoreProvider('invalid')).toBe(false);
        expect(isSessionStoreProvider(undefined)).toBe(false);
        expect(isSessionStoreProvider(null)).toBe(false);
        expect(isSessionStoreProvider(123)).toBe(false);
      });
    });
  });
});

describe('SessionStore configuration and provider validation', () => {
  beforeEach(() => {
    resetSessionStore();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ sessionStore: { provider: 'memory' } } as any);
  });

  it.each(['memory', 'custom'] as const)(
    'validates TTL and namespace before accessing %s configuration',
    (provider) => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: { provider, providerConfig: { module: FAKE_STORE_MODULE } },
      } as any);
      for (const options of [
        undefined,
        {},
        { ttlMs: undefined },
        { ttlMs: NaN },
        { ttlMs: Infinity },
        { ttlMs: '100' },
      ]) {
        expect(() => Reflect.apply(createNamespacedStore, undefined, ['ns', options])).toThrow(
          'ttlMs must be a finite number.',
        );
      }
      for (const namespace of ['', ':', 'a:b', undefined, null, 42]) {
        expect(() =>
          Reflect.apply(createNamespacedStore, undefined, [namespace, { ttlMs: 100 }]),
        ).toThrow('Namespace must be a non-empty string without ":".');
      }
      expect(getConfig).not.toHaveBeenCalled();
    },
  );

  it('loads named SessionStore exports', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sessionStore: {
        provider: 'custom',
        providerConfig: { module: './src/sessionStore/__fixtures__/namedSessionStore.cjs' },
      },
    } as any);
    await initializeSessionStore();
    const store = createNamespacedStore<string>('session', { ttlMs: 100 });
    await store.set('key', 'value');
    await expect(createNamespacedStore<string>('session', { ttlMs: 100 }).get('key')).resolves.toBe(
      'value',
    );
  });

  it('requires a default class or named SessionStore export', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sessionStore: {
        provider: 'custom',
        providerConfig: { module: './src/storage/__fixtures__/keyValueStore.cjs' },
      },
    } as any);
    await expect(initializeSessionStore()).rejects.toThrow(
      'Failed to load custom session store provider',
    );
    expect(() => createNamespacedStore('session', { ttlMs: 100 })).toThrow(
      'Session store is not initialized.',
    );
  });

  it('keeps a failed custom initialization unavailable without memory fallback or success logging', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sessionStore: {
        provider: 'custom',
        providerConfig: { module: REJECTING_LIFECYCLE_STORE_MODULE },
      },
    } as any);
    await expect(initializeSessionStore()).rejects.toThrow('init failed');
    expect(() => createNamespacedStore('session', { ttlMs: 100 })).toThrow(
      'Session store is not initialized.',
    );
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['module', 'constructor'] as const)(
    'does not expose configuration through %s failures',
    async (failure) => {
      const marker = 'PRIVATE_SESSION_CONFIG_MARKER';
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: {
            module:
              failure === 'module'
                ? `./${marker}.cjs`
                : './src/sessionStore/__fixtures__/throwingSessionStore.cjs',
            throwInConstructor: true,
            credential: marker,
          },
        },
      } as any);
      const error = await initializeSessionStore().catch((error: unknown) => error);
      expect(error).toHaveProperty(
        'message',
        'Failed to load custom session store provider. Check its module export and configuration.',
      );
      expect(inspect(error)).not.toContain(marker);
      expect(error).not.toHaveProperty('cause');
      expect(log).not.toHaveBeenCalled();
    },
  );
});
