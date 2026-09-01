import { z } from 'zod';

/**
 * Valid blob storage provider names
 */
export const blobStorageProviderSchema = z.enum(['noop', 'custom']);
export type BlobStorageProviderType = z.infer<typeof blobStorageProviderSchema>;

/**
 * Type guard for blob storage provider names
 */
export function isBlobStorageProviderType(
  provider: unknown,
): provider is BlobStorageProviderType {
  return blobStorageProviderSchema.safeParse(provider).success;
}

/**
 * Schema for noop blob storage config (no blob storage configured)
 */
export const noopBlobStorageConfigSchema = z.object({
  provider: z.literal('noop'),
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
 * Schema for custom blob storage config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-blob-storage-provider.js"
 *   }
 * }
 * ```
 */
export const customBlobStorageConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined blob storage config schema (discriminated union)
 */
export const blobStorageConfigSchema = z.discriminatedUnion('provider', [
  noopBlobStorageConfigSchema,
  customBlobStorageConfigSchema,
]);

export type BlobStorageConfig = z.infer<typeof blobStorageConfigSchema>;
