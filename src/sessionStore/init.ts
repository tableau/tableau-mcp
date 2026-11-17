import {
  createNamespacedKeyValueStore,
  disconnectKeyValueStore,
  initializeKeyValueStore,
  initializeSessionStore,
  resetKeyValueStore,
} from '../storage/init.js';

export { initializeSessionStore };

/** @deprecated Use initializeKeyValueStore from storage/init instead. */
export const connectSessionStore = initializeKeyValueStore;

/** @deprecated Use createNamespacedKeyValueStore from storage/init instead. */
export const createNamespacedStore = createNamespacedKeyValueStore;

/** @deprecated Use disconnectKeyValueStore from storage/init instead. */
export const disconnectSessionStore = disconnectKeyValueStore;

/** @deprecated Use resetKeyValueStore from storage/init instead. */
export const resetSessionStore = resetKeyValueStore;
