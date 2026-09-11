import { z } from 'zod';

/**
 * Valid session store provider names
 */
export const sessionStoreProviderSchema = z.enum(['memory', 'custom']);
export type SessionStoreProviderType = z.infer<typeof sessionStoreProviderSchema>;

/**
 * Type guard for session store provider names
 */
export function isSessionStoreProvider(provider: unknown): provider is SessionStoreProviderType {
  return sessionStoreProviderSchema.safeParse(provider).success;
}

/**
 * Schema for in-memory session store config (per-namespace InMemorySessionStore)
 */
export const memorySessionStoreConfigSchema = z.object({
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
 * Schema for custom session store config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-session-store.js"
 *   }
 * }
 * ```
 */
export const customSessionStoreConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined session store config schema (discriminated union)
 */
export const sessionStoreConfigSchema = z.discriminatedUnion('provider', [
  memorySessionStoreConfigSchema,
  customSessionStoreConfigSchema,
]);

export type SessionStoreConfig = z.infer<typeof sessionStoreConfigSchema>;
