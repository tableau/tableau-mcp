/** Independent KV provider initialization and access. */
import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { loadProviderModule } from '../utils/loadProviderModule.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';

let state: KeyValueStore<unknown> | null = null;

function validateProvider(provider: unknown): asserts provider is KeyValueStore<unknown> {
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
    throw new Error('Provider must be an object');
  }
  for (const method of ['get', 'set', 'delete', 'consume'] as const) {
    if (typeof (provider as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`Custom provider missing required method: ${method}`);
    }
  }
}

/** Construct the configured provider. KV providers do not have an init hook. */
export function initializeKeyValueStore(): void {
  if (state !== null) return;
  const storage = getConfig().keyValueStore;
  state =
    storage.provider === 'custom'
      ? loadCustomProvider(storage.providerConfig)
      : new InMemoryKeyValueStore<unknown>();
  log({ message: 'Key-value store ready', level: 'info', logger: 'storage' });
}

/** Return the configured implementation without constructing or wrapping it. */
export function getKeyValueStore(): KeyValueStore<unknown> {
  if (state === null) throw new Error('Key-value store is not initialized.');
  return state;
}

function loadCustomProvider(config: Record<string, unknown>): KeyValueStore<unknown> {
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
    const ProviderClass = module.default || module.KeyValueStore;
    if (!ProviderClass) {
      throw new Error('Module must export a default class or named export "KeyValueStore"');
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

/** Reset provider selection for tests. */
export function resetKeyValueStore(): void {
  state = null;
}
