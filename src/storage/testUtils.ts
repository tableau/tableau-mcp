import { initializeKeyValueStore, resetKeyValueStore } from './init.js';

/** Initialize a fresh provider instance using the test's config. Call after setting up config. */
export async function setupTestKeyValueStore(): Promise<void> {
  resetKeyValueStore();
  await initializeKeyValueStore();
}
