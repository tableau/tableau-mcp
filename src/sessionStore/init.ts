import {
  connectKeyValueStore,
  createNamespacedKeyValueStore,
  disconnectKeyValueStore,
  initializeKeyValueStore,
  resetKeyValueStore,
} from '../storage/init.js';

/** @deprecated Use connectKeyValueStore from storage/init instead. */
export const connectSessionStore = connectKeyValueStore;

/** @deprecated Use createNamespacedKeyValueStore from storage/init instead. */
export const createNamespacedStore = createNamespacedKeyValueStore;

/** @deprecated Use disconnectKeyValueStore from storage/init instead. */
export const disconnectSessionStore = disconnectKeyValueStore;

/** @deprecated Use initializeKeyValueStore from storage/init instead. */
export const initializeSessionStore = initializeKeyValueStore;

/** @deprecated Use resetKeyValueStore from storage/init instead. */
export const resetSessionStore = resetKeyValueStore;
