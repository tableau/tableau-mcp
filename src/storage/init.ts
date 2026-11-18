/** Independent KV provider initialization and access. */
import { resolve } from 'path';

import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { loadProviderModule } from '../utils/loadProviderModule.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';

let state: KeyValueStore<unknown> | null = null;
let initialization: Promise<void> | null = null;
let closing: Promise<void> | null = null;

function validateProvider(provider: unknown): asserts provider is KeyValueStore<unknown> {
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
    throw new Error('Provider must be an object');
  }
  for (const method of ['get', 'set', 'delete', 'consume'] as const) {
    if (typeof (provider as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`Custom provider missing required method: ${method}`);
    }
  }
  for (const method of ['init', 'close'] as const) {
    const hook = (provider as Record<string, unknown>)[method];
    if (hook !== undefined && typeof hook !== 'function') {
      throw new Error(`Custom provider lifecycle hook must be a function: ${method}`);
    }
  }
}

/** Construct and initialize one provider, sharing pending initialization between callers. */
export function initializeKeyValueStore(): Promise<void> {
  if (closing !== null) return closing.then(() => initializeKeyValueStore());
  if (initialization !== null) return initialization;
  if (state !== null) return Promise.resolve();
  initialization = initializeProvider().finally(() => {
    initialization = null;
  });
  return initialization;
}

async function initializeProvider(): Promise<void> {
  const storage = getConfig().keyValueStore;
  const provider: KeyValueStore<unknown> =
    storage.provider === 'custom'
      ? loadCustomProvider(storage.providerConfig)
      : new InMemoryKeyValueStore<unknown>();
  try {
    await provider.init?.();
  } catch {
    // Backend errors may contain credentials or connection strings. Do not retain a raw cause.
    throw new Error(
      'Failed to initialize key-value store provider. Check its backend and configuration.',
    );
  }
  state = provider;
  log({ message: 'Key-value store ready', level: 'info', logger: 'storage' });
}

/** Release the provider once, sharing pending cleanup between callers. */
export function closeKeyValueStore(): Promise<void> {
  if (closing !== null) return closing;
  closing = closeProvider().finally(() => {
    closing = null;
  });
  return closing;
}

async function closeProvider(): Promise<void> {
  try {
    await initialization;
  } catch {
    // Initialization failed without exposing a provider; its error is reported by startup.
    return;
  }
  const provider = state;
  state = null;
  try {
    await provider?.close?.();
  } catch {
    throw new Error('Failed to close key-value store provider.');
  }
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
  initialization = null;
  closing = null;
}
