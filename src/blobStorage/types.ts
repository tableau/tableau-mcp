import { z } from 'zod';

/**
 * Valid blob storage provider names. Unset means no blob storage; there is deliberately no
 * `noop` provider because "no storage" changes tool behavior rather than no-op'ing calls.
 */
export const blobStorageProviderSchema = z.enum(['custom']);
export type BlobStorageProviderType = z.infer<typeof blobStorageProviderSchema>;

/**
 * Type guard for blob storage provider names
 */
export function isBlobStorageProviderType(provider: unknown): provider is BlobStorageProviderType {
  return blobStorageProviderSchema.safeParse(provider).success;
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

export type BlobStorageConfig = z.infer<typeof customBlobStorageConfigSchema>;
