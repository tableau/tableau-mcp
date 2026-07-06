import { z } from 'zod';

/**
 * Feature gate provider interface
 */
export interface FeatureGateProvider {
  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(featureName: string): boolean;
}

/**
 * Valid feature gate provider names
 */
export const featureGateProviderSchema = z.enum(['server', 'custom']);
export type FeatureGateProviderType = z.infer<typeof featureGateProviderSchema>;

/**
 * Type guard for feature gate provider names
 */
export function isFeatureGateProvider(provider: unknown): provider is FeatureGateProviderType {
  return featureGateProviderSchema.safeParse(provider).success;
}

/**
 * Schema for server feature gate config (uses features.json file)
 */
export const serverFeatureGateConfigSchema = z.object({
  provider: z.literal('server'),
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
 * Schema for custom feature gate config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-feature-gate-provider.js"
 *   }
 * }
 * ```
 */
export const customFeatureGateConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined feature gate config schema (discriminated union)
 */
export const featureGateConfigSchema = z.discriminatedUnion('provider', [
  serverFeatureGateConfigSchema,
  customFeatureGateConfigSchema,
]);

export type FeatureGateConfig = z.infer<typeof featureGateConfigSchema>;
