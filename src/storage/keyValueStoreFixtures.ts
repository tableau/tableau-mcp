import { initializeKeyValueStore, resetKeyValueStore } from './init.js';

/** Give proof-consuming tests the fresh provider that production initializes at startup. */
export function resetTestKeyValueStore(): void {
  resetKeyValueStore();
  initializeKeyValueStore();
}
