import { z } from 'zod';

import { requiredString } from '../../utils/requiredString.js';

export const mcpAuthorizeSchema = z.object({
  client_id: requiredString('client_id'),
  redirect_uri: requiredString('redirect_uri'),
  response_type: requiredString('response_type'),
  code_challenge: requiredString('code_challenge'),
  code_challenge_method: requiredString('code_challenge_method'),
  state: z.string().optional(),
  scope: z.string().optional(),
});

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
      scope: z.string().optional(),
    }),
  )
  .transform((data) => {
    const { client_id, client_secret, scope } = data;
    const clientIdSecretPair = {
      clientId: client_id,
      clientSecret: client_secret,
      scope,
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
  scope: z.string().optional(),
});

export const mcpAccessTokenSchema = mcpAccessTokenUserOnlySchema.extend({
  tableauAccessToken: requiredString('tableauAccessToken'),
  tableauRefreshToken: requiredString('tableauRefreshToken'),
  tableauExpiresAt: z.number().int().nonnegative(),
  // Required because it is always available when a user's Tableau access token is available
  tableauUserId: requiredString('tableauUserId'),
});

export const tableauBearerTokenSchema = z.object({
  iss: requiredString('iss'),
  aud: requiredString('aud'),
  exp: z.number().int().nonnegative(),
  sub: requiredString('sub'),
  scope: requiredString('scope'),
  'https://tableau.com/siteId': requiredString('https://tableau.com/siteId'),
  'https://tableau.com/targetUrl': requiredString('https://tableau.com/targetUrl'),
});

export type McpAccessToken = z.infer<typeof mcpAccessTokenSchema>;
export type McpAccessTokenSubOnly = z.infer<typeof mcpAccessTokenUserOnlySchema>;

export const tableauAuthInfoSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('X-Tableau-Auth'),
    username: z.string(),
    userId: z.string().optional(),
    server: z.string(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
  }),
  z.object({
    type: z.literal('Bearer'),
    username: z.string(),
    server: z.string(),
    siteId: z.string(),
    raw: z.string(),
  }),
]);

export const cimdMetadataSchema = z.object({
  client_id: z.string(),
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().optional(),
  logo_uri: z.string().url().optional(),
  client_uri: z.string().url().optional(),
  tos_uri: z.string().url().optional(),
  policy_uri: z.string().url().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.enum(['code', 'token'])).optional(),
  post_logout_redirect_uris: z.array(z.string().url()).optional(),
  scope: z.string().default('read').optional(),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_basic', 'client_secret_post'])
    .optional(),
});

export type TableauAuthInfo = z.infer<typeof tableauAuthInfoSchema>;
export type McpAuthorizeRequest = z.infer<typeof mcpAuthorizeSchema>;
export type ClientMetadata = z.infer<typeof cimdMetadataSchema>;
