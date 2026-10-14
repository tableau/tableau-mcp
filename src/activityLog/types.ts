import { z } from 'zod';

/**
 * Valid Activity Log provider names
 */
export const activityLogProviderSchema = z.enum(['noop', 'custom']);
export type ActivityLogProviderType = z.infer<typeof activityLogProviderSchema>;

/**
 * Type guard for Activity Log provider names
 */
export function isActivityLogProvider(provider: unknown): provider is ActivityLogProviderType {
  return activityLogProviderSchema.safeParse(provider).success;
}

/**
 * Schema for provider config (module path + optional provider-specific options)
 */
export const providerConfigSchema = z
  .object({
    module: z.string({ required_error: 'Custom provider requires "module" path' }),
  })
  .passthrough();

/**
 * Schema for the no-op config (nothing is recorded)
 */
export const noopActivityLogConfigSchema = z.object({
  provider: z.literal('noop'),
});

/**
 * Schema for custom Activity Log config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-activity-log-provider.js"
 *   }
 * }
 * ```
 */
export const customActivityLogConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined Activity Log config schema (discriminated union)
 */
export const activityLogConfigSchema = z.discriminatedUnion('provider', [
  noopActivityLogConfigSchema,
  customActivityLogConfigSchema,
]);

export type ActivityLogConfig = z.infer<typeof activityLogConfigSchema>;
