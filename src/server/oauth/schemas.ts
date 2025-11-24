import { z } from 'zod';

import { requiredString } from '../../utils/requiredString.js';

export const mcpAuthorizeSchema = z
  .object({
    client_id: requiredString('client_id'),
    redirect_uri: requiredString('redirect_uri'),
    response_type: requiredString('response_type'),
    code_challenge: requiredString('code_challenge'),
    code_challenge_method: requiredString('code_challenge_method'),
    state: z.string().optional(),
  })
  .transform((data) => ({
    clientId: data.client_id,
    redirectUri: data.redirect_uri,
    responseType: data.response_type,
    codeChallenge: data.code_challenge,
    codeChallengeMethod: data.code_challenge_method,
    state: data.state,
  }));

export const mcpTokenSchema = z
  .discriminatedUnion(
    'grant_type',
    [
      z.object({
        grant_type: z.literal('authorization_code'),
        code: requiredString('code'),
        redirect_uri: requiredString('redirect_uri'),
        code_verifier: requiredString('code_verifier'),
      }),
      z.object({
        grant_type: z.literal('refresh_token'),
        refresh_token: requiredString('refresh_token'),
      }),
      z.object({
        grant_type: z.literal('client_credentials'),
      }),
      z.object({
        grant_type: z.literal('tableau_access_token'),
      }),
    ],
    {
      errorMap: (issue, ctx) => ({
        message:
          issue.code === 'invalid_union_discriminator'
            ? `grant_type must be ${issue.options.map((opt) => `'${String(opt)}'`).join(' | ')}, got '${ctx.data.grant_type}'.`
            : ctx.defaultError,
      }),
    },
  )
  .and(
    z.object({
      // Optional because client/secret pair may be provided in the request body instead of the query string
      client_id: z.string().optional(),
      client_secret: z.string().optional(),
    }),
  )
  .transform((data) => {
    const { client_id, client_secret } = data;
    const clientIdSecretPair = {
      clientId: client_id,
      clientSecret: client_secret,
    };

    if (data.grant_type === 'authorization_code') {
      return {
        grantType: data.grant_type,
        code: data.code,
        redirectUri: data.redirect_uri,
        codeVerifier: data.code_verifier,
        ...clientIdSecretPair,
      };
    }

    if (data.grant_type === 'refresh_token') {
      return {
        grantType: data.grant_type,
        refreshToken: data.refresh_token,
        ...clientIdSecretPair,
      };
    }

    return {
      grantType: data.grant_type,
      ...clientIdSecretPair,
    };
  });

export const callbackSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const mcpAccessTokenUserOnlySchema = z.object({
  iss: requiredString('iss'),
  aud: requiredString('aud'),
  exp: z.number().int().nonnegative(),
  sub: requiredString('sub'),
  clientId: requiredString('clientId'),
  tableauServer: requiredString('tableauServer'),
  // Optional because there may not be a user associated with the access token, e.g. for client credentials grant type
  tableauUserId: z.string().optional(),
});

export const mcpAccessTokenSchema = mcpAccessTokenUserOnlySchema.extend({
  tableauAccessToken: requiredString('tableauAccessToken'),
  tableauRefreshToken: z.string().optional(),
  tableauExpiresAt: z.number().int().nonnegative().optional(),
  // Required because it is always available when a user's Tableau access token is available
  tableauUserId: requiredString('tableauUserId'),
});

export type McpAccessToken = z.infer<typeof mcpAccessTokenSchema>;
export type McpAccessTokenSubOnly = z.infer<typeof mcpAccessTokenUserOnlySchema>;

export const tableauAuthInfoSchema = z
  .object({
    username: z.string(),
    userId: z.string(),
    server: z.string(),
    accessToken: z.string(),
    refreshToken: z.string().optional(),
  })
  .partial();

export type TableauAuthInfo = z.infer<typeof tableauAuthInfoSchema>;
