import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({
    sessionStore: { provider: 'memory' },
  })),
}));

import { getConfig } from '../config.js';
import { createNamespacedStore, initializeSessionStore, resetSessionStore } from './init.js';
import { isSessionStoreProvider, sessionStoreProviderSchema } from './types.js';

const FAKE_STORE_MODULE = './src/sessionStore/__fixtures__/fakeSessionStore.cjs';
const NO_ROTATE_STORE_MODULE = './src/sessionStore/__fixtures__/noRotateSessionStore.cjs';

describe('SessionStore init', () => {
  beforeEach(() => {
    resetSessionStore();
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue({ sessionStore: { provider: 'memory' } } as any);
  });

  describe('provider selection', () => {
    it('defaults to the memory provider when unconfigured', async () => {
      const store = createNamespacedStore<string>('ns');
      await store.set('key', 'value', 10000);
      await expect(store.get('key')).resolves.toBe('value');
    });

    it('loads a custom provider successfully from a fixture module', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: FAKE_STORE_MODULE },
        },
      } as any);

      initializeSessionStore();
      const store = createNamespacedStore<string>('ns');

      await store.set('key', 'value', 10000);
      await expect(store.get('key')).resolves.toBe('value');

      // Proves the custom backend (not the memory fallback) is in use: two calls for the same
      // namespace share the one loaded provider, whereas the memory path returns fresh instances.
      const second = createNamespacedStore<string>('ns');
      await expect(second.get('key')).resolves.toBe('value');
    });

    it('falls back to memory when the custom module is missing "module"', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: { provider: 'custom', providerConfig: {} },
      } as any);

      initializeSessionStore();

      // Two calls on the memory fallback must be independent instances.
      const a = createNamespacedStore<string>('ns');
      const b = createNamespacedStore<string>('ns');
      await a.set('key', 'value', 10000);
      await expect(b.get('key')).resolves.toBeUndefined();
    });

    it('falls back to memory when the custom module fails to load', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: './nonexistent-provider.cjs' },
        },
      } as any);

      initializeSessionStore();
      const store = createNamespacedStore<string>('ns');

      await store.set('key', 'value', 10000);
      await expect(store.get('key')).resolves.toBe('value');
    });

    it('falls back to memory when a custom provider is missing rotate', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: NO_ROTATE_STORE_MODULE },
        },
      } as any);

      initializeSessionStore();

      // Memory fallback: fresh independent instances per call.
      const a = createNamespacedStore<string>('ns');
      const b = createNamespacedStore<string>('ns');
      await a.set('key', 'value', 10000);
      await expect(b.get('key')).resolves.toBeUndefined();
    });

    it('falls back to memory when getConfig throws', async () => {
      vi.mocked(getConfig).mockImplementation(() => {
        throw new Error('Config error');
      });

      initializeSessionStore();
      const store = createNamespacedStore<string>('ns');

      await store.set('key', 'value', 10000);
      await expect(store.get('key')).resolves.toBe('value');
    });
  });

  describe('createNamespacedStore', () => {
    it('returns independent stores for the same namespace on the memory path', async () => {
      const a = createNamespacedStore<string>('ns');
      const b = createNamespacedStore<string>('ns');

      await a.set('key', 'value', 10000);
      await expect(a.get('key')).resolves.toBe('value');
      await expect(b.get('key')).resolves.toBeUndefined();
    });

    it('lazily initializes when initializeSessionStore was not called', async () => {
      // No initializeSessionStore() call; createNamespacedStore initializes on demand.
      const store = createNamespacedStore<string>('ns');
      await store.set('key', 'value', 10000);
      await expect(store.get('key')).resolves.toBe('value');
    });

    it('isolates identical raw keys across namespaces sharing one custom backend', async () => {
      vi.mocked(getConfig).mockReturnValue({
        sessionStore: {
          provider: 'custom',
          providerConfig: { module: FAKE_STORE_MODULE },
        },
      } as any);

      initializeSessionStore();

      const nsA = createNamespacedStore<string>('alpha');
      const nsB = createNamespacedStore<string>('beta');

      await nsA.set('shared', 'a-value', 10000);
      await nsB.set('shared', 'b-value', 10000);

      // Prefixing keeps the identical raw key 'shared' from colliding on the shared backend.
      await expect(nsA.get('shared')).resolves.toBe('a-value');
      await expect(nsB.get('shared')).resolves.toBe('b-value');

      // rotate on one namespace prefixes both keys and does not disturb the other.
      await nsA.rotate!('shared', 'rotated', 'a-rotated', 10000);
      await expect(nsA.get('shared')).resolves.toBeUndefined();
      await expect(nsA.get('rotated')).resolves.toBe('a-rotated');
      await expect(nsB.get('shared')).resolves.toBe('b-value');
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
