import { z } from 'zod';

/**
 * Valid upload URL provider names
 */
export const uploadUrlProviderSchema = z.enum(['server', 'custom']);
export type UploadUrlProviderType = z.infer<typeof uploadUrlProviderSchema>;

/**
 * Type guard for upload URL provider names
 */
export function isUploadUrlProvider(provider: unknown): provider is UploadUrlProviderType {
  return uploadUrlProviderSchema.safeParse(provider).success;
}

/**
 * Schema for server upload URL config (default: raw S3 presigned PUT URL)
 */
export const serverUploadUrlConfigSchema = z.object({
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
 * Schema for custom upload URL config
 *
 * @example
 * ```json
 * {
 *   "provider": "custom",
 *   "providerConfig": {
 *     "module": "./my-upload-url-provider.js"
 *   }
 * }
 * ```
 */
export const customUploadUrlConfigSchema = z.object({
  provider: z.literal('custom'),
  providerConfig: providerConfigSchema,
});

/**
 * Combined upload URL config schema (discriminated union)
 */
export const uploadUrlConfigSchema = z.discriminatedUnion('provider', [
  serverUploadUrlConfigSchema,
  customUploadUrlConfigSchema,
]);

export type UploadUrlConfig = z.infer<typeof uploadUrlConfigSchema>;
