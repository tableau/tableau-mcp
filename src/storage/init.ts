/** Independent KV provider initialization and access. */
import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';
import { loadCustomProvider } from './provider.js';

let state: KeyValueStore<unknown> | null = null;
let initialization: Promise<void> | null = null;
let closing: Promise<void> | null = null;

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
  log({
    message: 'Key-value store ready',
    level: 'info',
    logger: 'storage',
    data: { provider: storage.provider },
  });
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

/** Reset provider selection for tests. */
export function resetKeyValueStore(): void {
  state = null;
  initialization = null;
  closing = null;
}
