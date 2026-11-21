import { inspect } from 'node:util';

vi.mock('../config.js', () => ({ getConfig: vi.fn() }));
vi.mock('../logging/logger.js', () => ({ log: vi.fn() }));
vi.mock('./provider.js', () => ({ loadCustomProvider: vi.fn() }));

import { getConfig } from '../config.js';
import {
  closeKeyValueStore,
  getKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from './init.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import { loadCustomProvider } from './provider.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('key-value store lifecycle', () => {
  let provider: InMemoryKeyValueStore<unknown>;

  beforeEach(() => {
    resetKeyValueStore();
    vi.clearAllMocks();
    provider = new InMemoryKeyValueStore();
    vi.mocked(loadCustomProvider).mockReturnValue(provider);
    vi.mocked(getConfig, { partial: true }).mockReturnValue({
      keyValueStore: {
        provider: 'custom',
        providerConfig: { module: 'test-provider' },
      },
    });
  });

  describe('getKeyValueStore', () => {
    it('requires initialization and never loads a provider from the getter', () => {
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
      expect(getConfig).not.toHaveBeenCalled();
    });
  });

  describe('initializeKeyValueStore', () => {
    it('returns one actual memory implementation and preserves it on repeated initialization', async () => {
      vi.mocked(getConfig, { partial: true }).mockReturnValue({
        keyValueStore: { provider: 'memory' },
      });
      await initializeKeyValueStore();
      const store = getKeyValueStore();
      expect(store).toBeInstanceOf(InMemoryKeyValueStore);
      await initializeKeyValueStore();
      expect(getKeyValueStore()).toBe(store);
      expect(getConfig).toHaveBeenCalledOnce();
    });

    it('keeps the store unavailable when its provider cannot load', async () => {
      vi.mocked(loadCustomProvider).mockImplementationOnce(() => {
        throw new Error('Unable to load provider');
      });
      await expect(initializeKeyValueStore()).rejects.toThrow('Unable to load provider');
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
    });

    it('awaits init before making the provider available', async () => {
      const ready = deferred();
      const init = vi.fn(() => ready.promise);
      Object.assign(provider, { init });

      const initializing = initializeKeyValueStore();
      expect(init).toHaveBeenCalledOnce();
      expect(getConfig).toHaveBeenCalledOnce();
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');

      ready.resolve();
      await initializing;
      expect(getKeyValueStore()).toBe(provider);
    });

    it('supports synchronous initialization', async () => {
      const init = vi.fn();
      Object.assign(provider, { init });
      await initializeKeyValueStore();
      expect(init).toHaveBeenCalledOnce();
      expect(getKeyValueStore()).toBe(provider);
    });

    it.each(['sync', 'async'] as const)('sanitizes %s initialization failures', async (mode) => {
      const marker = 'PRIVATE_KV_INIT_CREDENTIAL';
      const init = (): void | Promise<void> => {
        const failure = new Error(marker, { cause: new Error(marker) });
        if (mode === 'sync') throw failure;
        return Promise.reject(failure);
      };
      Object.assign(provider, { init });

      const failure = await initializeKeyValueStore().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toHaveProperty(
        'message',
        'Failed to initialize key-value store provider. Check its backend and configuration.',
      );
      expect(inspect(failure)).not.toContain(marker);
      expect(failure).not.toHaveProperty('cause');
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
    });

    it('allows retrying initialization after a failed attempt', async () => {
      const init = vi
        .fn()
        .mockRejectedValueOnce(new Error('unavailable'))
        .mockResolvedValue(undefined);
      Object.assign(provider, { init });
      await expect(initializeKeyValueStore()).rejects.toThrow('Failed to initialize');
      await initializeKeyValueStore();
      expect(init).toHaveBeenCalledTimes(2);
      expect(getKeyValueStore()).toBe(provider);
    });
  });

  describe('closeKeyValueStore', () => {
    it('closes the provider only once when shutdown is called twice', async () => {
      const close = vi.fn();
      Object.assign(provider, { close });
      await initializeKeyValueStore();

      await closeKeyValueStore();
      await closeKeyValueStore();

      expect(close).toHaveBeenCalledOnce();
      expect(() => getKeyValueStore()).toThrow('Key-value store is not initialized.');
    });

    it('reports a generic error when the provider rejects close()', async () => {
      const close = vi.fn().mockRejectedValue(new Error('private backend details'));
      Object.assign(provider, { close });
      await initializeKeyValueStore();

      const closing = closeKeyValueStore();
      await expect(closing).rejects.toHaveProperty(
        'message',
        'Failed to close key-value store provider.',
      );
      await expect(closing).rejects.not.toHaveProperty('cause');
    });

    it('closing an uninitialized provider does not construct one', async () => {
      await closeKeyValueStore();
      expect(getConfig).not.toHaveBeenCalled();
    });
  });
});
