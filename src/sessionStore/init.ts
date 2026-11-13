import {
  connectKeyValueStore,
  createNamespacedKeyValueStore,
  disconnectKeyValueStore,
  initializeSessionStore,
  resetKeyValueStore,
} from '../storage/storageProvider.js';

export { initializeSessionStore };

/** @deprecated Use connectKeyValueStore from storage/storageProvider instead. */
export const connectSessionStore = connectKeyValueStore;

/** @deprecated Use createNamespacedKeyValueStore from storage/storageProvider instead. */
export const createNamespacedStore = createNamespacedKeyValueStore;

/** @deprecated Use disconnectKeyValueStore from storage/storageProvider instead. */
export const disconnectSessionStore = disconnectKeyValueStore;

/** @deprecated Use resetKeyValueStore from storage/storageProvider instead. */
export const resetSessionStore = resetKeyValueStore;
