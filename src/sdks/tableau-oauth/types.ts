import { z } from 'zod';

import { requiredString } from '../../utils/requiredStrings.js';

export const tableauAccessTokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string(),
    code_verifier: z.string(),
    redirect_uri: z.string(),
    client_id: z.string(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    client_id: z.string(),
    refresh_token: z.string(),
    site_namespace: z.string(),
  }),
]);

export const tableauAccessTokenResponseSchema = z
  .object({
    access_token: requiredString('access_token'),
    expires_in: z.number().int().nonnegative(),
    refresh_token: requiredString('refresh_token'),
    origin_host: requiredString('origin_host'),
  })
  .transform((data) => ({
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in,
    refreshToken: data.refresh_token,
    originHost: data.origin_host,
  }));

export type TableauAccessTokenRequest = z.infer<typeof tableauAccessTokenRequestSchema>;
export type TableauAccessToken = z.infer<typeof tableauAccessTokenResponseSchema>;
