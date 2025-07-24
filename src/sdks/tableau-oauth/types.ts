import { z } from 'zod';

import { requiredString } from '../../utils/requiredStrings.js';

export const tableauAccessTokenRequestSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  code: z.string(),
  code_verifier: z.string(),
  redirect_uri: z.string(),
  client_id: z.string(),
});

export const tableauAccessTokenResponseSchema = z
  .object({
    access_token: requiredString('access_token'),
    expires_in: z.number().int().nonnegative(),
    refresh_token: requiredString('refresh_token'),
  })
  .transform((data) => ({
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in,
    refreshToken: data.refresh_token,
  }));

export type TableauAccessTokenRequest = z.infer<typeof tableauAccessTokenRequestSchema>;
export type TableauAccessToken = z.infer<typeof tableauAccessTokenResponseSchema>;
