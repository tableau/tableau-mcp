/** Independent KV provider initialization and access. */
import { getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import { InMemoryKeyValueStore } from './inMemoryKeyValueStore.js';
import type { KeyValueStore } from './keyValueStore.js';
import { loadCustomProvider } from './provider.js';

let state: KeyValueStore<unknown> | null = null;

/** Construct the configured provider and await its optional init hook. */
export async function initializeKeyValueStore(): Promise<void> {
  if (state !== null) return;
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

/** Release the current provider and await its optional close hook. */
export async function closeKeyValueStore(): Promise<void> {
  const provider = state;
  state = null;
  try {
    await provider?.close?.();
  } catch {
    throw new Error('Failed to close key-value store provider.');
  }
}

/**
 * Return the configured implementation without constructing or wrapping it.
 * Values are unknown because callers share the store; validate get()/consume() results before use.
 */
export function getKeyValueStore(): KeyValueStore<unknown> {
  if (state === null) throw new Error('Key-value store is not initialized.');
  return state;
}

/** Reset provider selection for tests. */
export function resetKeyValueStore(): void {
  state = null;
}
