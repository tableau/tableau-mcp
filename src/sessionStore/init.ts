/** Compatibility entry points sharing the generic KV provider and namespace factory. */
export {
  connectKeyValueStore as connectSessionStore,
  createNamespacedKeyValueStore as createNamespacedStore,
  disconnectKeyValueStore as disconnectSessionStore,
  initializeKeyValueStore as initializeSessionStore,
  resetKeyValueStore as resetSessionStore,
} from '../storage/init.js';
