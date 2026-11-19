import { initializeKeyValueStore, resetKeyValueStore } from './init.js';

/** Give proof-consuming tests the fresh provider that production initializes at startup. */
export async function resetTestKeyValueStore(): Promise<void> {
  resetKeyValueStore();
  await initializeKeyValueStore();
}
