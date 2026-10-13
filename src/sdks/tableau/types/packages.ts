import { z } from 'zod';

/**
 * Response of the experimental
 * `GET /api/exp/sites/:siteId/packages/allowed-origins` endpoint: the site's external
 * allowed-origins allow-list for extension packages (`extensionPackageAllowedOrigins`).
 *
 * The `origin` array is absent when the allow-list is empty, and the endpoint is experimental,
 * so the shape is kept permissive.
 */
export const allowedOriginsSchema = z.object({
  extensionPackageAllowedOrigins: z
    .object({
      origin: z.array(z.string()).optional(),
    })
    .optional(),
});

export type AllowedOrigins = z.infer<typeof allowedOriginsSchema>;
