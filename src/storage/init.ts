/** Configured KV provider loading, lifecycle, and namespaced store factories. */
import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { loadProviderModule } from '../utils/loadProviderModule.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';

type NamespaceOptions = { ttlMs: number; maxSize?: number };

// Provider hooks are optional infrastructure concerns, not part of the consumer KV interface.
// Existing SessionStore providers already use these hooks and remain compatible.
type StoreProvider<V = unknown> = KeyValueStore<V> & {
  configureNamespace?(namespace: string, options: NamespaceOptions): void;
  /** @deprecated Legacy SessionStore hook. Still awaited for backward compatibility. */
  init?(): Promise<void>;
  close?(): Promise<void>;
};

type StoreState = { kind: 'memory' } | { kind: 'custom'; store: StoreProvider };
let state: StoreState | null = null;

function validateProvider(provider: unknown): asserts provider is StoreProvider {
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
    throw new Error('Provider must be an object');
  }
  for (const method of ['get', 'set', 'delete', 'consume'] as const) {
    if (typeof (provider as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`Custom provider missing required method: ${method}`);
    }
  }
}

/** Select and initialize the configured provider before the server reports healthy. */
export async function initializeKeyValueStore(): Promise<void> {
  if (state !== null) return;
  const config = getConfig();
  // sessionStore supports existing integrations supplying the legacy configuration property.
  const storeConfig = config.keyValueStore ?? config.sessionStore;
  const selected: StoreState =
    storeConfig.provider === 'custom'
      ? { kind: 'custom', store: loadCustomProvider(storeConfig.providerConfig) }
      : { kind: 'memory' };
  if (selected.kind === 'custom') await selected.store.init?.();
  state = selected;
  log({
    message: 'Key-value store ready',
    level: 'info',
    logger: 'storage',
  });
}

/** Release an optional provider connection on shutdown, once per shared backend. */
export async function disconnectKeyValueStore(): Promise<void> {
  if (state?.kind === 'custom') await state.store.close?.();
  log({
    message: 'Key-value store shutdown complete',
    level: 'info',
    logger: 'storage',
  });
}

function loadCustomProvider(config: Record<string, unknown>): StoreProvider {
  if (!config.module) {
    throw new Error('Custom key-value store provider requires "module" in providerConfig');
  }
  if (typeof config.module !== 'string') {
    throw new Error('Custom key-value store provider requires "module" to be a string');
  }
  const modulePath = config.module;
  const resolvedPath =
    modulePath.startsWith('.') || modulePath.startsWith('/')
      ? resolve(process.cwd(), modulePath)
      : modulePath;

  try {
    // Module paths come only from trusted operator configuration, like the other BYOI providers.
    const module = loadProviderModule(resolvedPath, require);
    const ProviderClass = module.default || module.KeyValueStore || module.SessionStore;
    if (!ProviderClass) {
      throw new Error(
        'Module must export a default class or named export "KeyValueStore" (legacy "SessionStore" is also supported)',
      );
    }
    const provider: unknown = new ProviderClass(config);
    validateProvider(provider);
    return provider;
  } catch {
    // Module and constructor errors may echo configuration. Do not retain a raw cause.
    throw new Error(
      'Failed to load custom key-value store provider. Check its module export and configuration.',
    );
  }
}

/**
 * Create a namespace using the configured backend. Memory instances remain independent;
 * custom providers share one backend with prefixed keys and optional namespace configuration.
 * Namespaces must be non-empty strings without colons; keys may contain colons.
 * Every namespace requires an explicit TTL in milliseconds, matching the legacy session contract.
 */
export function createNamespacedKeyValueStore<V>(
  namespace: string,
  options: NamespaceOptions,
): KeyValueStore<V> {
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.includes(':')) {
    throw new Error('Namespace must be a non-empty string without ":".');
  }
  if (!Number.isFinite(options?.ttlMs)) {
    throw new Error('ttlMs must be a finite number.');
  }
  if (state === null) {
    throw new Error('Key-value store is not initialized.');
  }
  if (state.kind === 'memory') return new InMemoryKeyValueStore<V>(options);

  const shared = state.store as StoreProvider<V>;
  shared.configureNamespace?.(namespace, options);
  const prefix = `${namespace}:`;
  return {
    get: (key) => shared.get(`${prefix}${key}`),
    set: (key, value) => shared.set(`${prefix}${key}`, value),
    delete: (key) => shared.delete(`${prefix}${key}`),
    consume: (key) => shared.consume(`${prefix}${key}`),
  };
}

/** Reset provider selection for tests. */
export function resetKeyValueStore(): void {
  state = null;
}

/** @deprecated Await initializeKeyValueStore from storage/init instead. */
export const initializeSessionStore = initializeKeyValueStore;
