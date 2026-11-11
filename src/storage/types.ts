import { z } from 'zod';

/**
 * Valid key-value store provider names
 */
export const keyValueStoreProviderSchema = z.enum(['memory', 'custom']);
export type KeyValueStoreProviderType = z.infer<typeof keyValueStoreProviderSchema>;

/**
 * Type guard for key-value store provider names
 */
export function isKeyValueStoreProvider(provider: unknown): provider is KeyValueStoreProviderType {
  return keyValueStoreProviderSchema.safeParse(provider).success;
}

/**
 * Schema for in-memory key-value store config (per-namespace InMemoryKeyValueStore)
 */
export const memoryKeyValueStoreConfigSchema = z.object({
  provider: z.literal('memory'),
});

/**
 * Schema for provider config (module path + optional provider-specific options)
 */
export const providerConfigSchema = z
  .object({
    module: z.string({ required_error: 'Custom provider requires "module" path' }),
  })
  .passthrough();

/**
 * Schema for custom key-value store config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-key-value-store.js"
 *   }
 * }
 * ```
 */
export const customKeyValueStoreConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined key-value store config schema (discriminated union)
 */
export const keyValueStoreConfigSchema = z.discriminatedUnion('provider', [
  memoryKeyValueStoreConfigSchema,
  customKeyValueStoreConfigSchema,
]);

export type KeyValueStoreConfig = z.infer<typeof keyValueStoreConfigSchema>;
