/** Compatibility exports for existing session-provider configuration. */
export {
  customKeyValueStoreConfigSchema as customSessionStoreConfigSchema,
  isKeyValueStoreProvider as isSessionStoreProvider,
  memoryKeyValueStoreConfigSchema as memorySessionStoreConfigSchema,
  providerConfigSchema,
  type KeyValueStoreConfig as SessionStoreConfig,
  keyValueStoreConfigSchema as sessionStoreConfigSchema,
  keyValueStoreProviderSchema as sessionStoreProviderSchema,
  type KeyValueStoreProviderType as SessionStoreProviderType,
} from '../storage/types.js';
