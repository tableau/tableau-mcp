import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';

const requiredString = (property: string): z.ZodString =>
  z
    .string({ message: `${property} is required` })
    .nonempty({ message: `${property} must be non-empty` });

export const mcpAuthorizeSchema = z
  .object({
    client_id: requiredString('client_id'),
    redirect_uri: requiredString('redirect_uri'),
    response_type: requiredString('response_type'),
    code_challenge: requiredString('code_challenge'),
    code_challenge_method: requiredString('code_challenge_method'),
    state: z.string().optional(),
    scope: z.string().optional(),
  })
  .transform((data) => ({
    clientId: data.client_id,
    redirectUri: data.redirect_uri,
    responseType: data.response_type,
    codeChallenge: data.code_challenge,
    codeChallengeMethod: data.code_challenge_method,
    state: data.state,
    scope: data.scope,
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
        client_id: requiredString('client_id'),
      }),
      z.object({
        grant_type: z.literal('refresh_token'),
        refresh_token: requiredString('refresh_token'),
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
  .transform((data) => {
    if (data.grant_type === 'authorization_code') {
      return {
        grantType: data.grant_type,
        code: data.code,
        redirectUri: data.redirect_uri,
        codeVerifier: data.code_verifier,
        clientId: data.client_id,
      };
    }

    return {
      grantType: data.grant_type,
      refreshToken: data.refresh_token,
    };
  });

export const callbackSchema = z.object({
  code: requiredString('code'),
  state: requiredString('state'),
  error: z.string().optional(),
});

export const tableauAccessTokenSchema = z
  .object({
    access_token: requiredString('access_token'),
    expires_in: z.number().int().positive(),
    refresh_token: requiredString('refresh_token'),
  })
  .transform((data) => ({
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
  }));

export type TableauAccessToken = z.infer<typeof tableauAccessTokenSchema>;

export const mcpAccessTokenSchema = z.object({
  sub: requiredString('sub'),
  tableauAccessToken: requiredString('tableauAccessToken'),
  tableauRefreshToken: requiredString('tableauRefreshToken'),
});

export type McpAccessToken = z.infer<typeof mcpAccessTokenSchema>;

export const tableauAuthInfoSchema = z
  .object({
    userId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .partial();

export type TableauAuthInfo = z.infer<typeof tableauAuthInfoSchema>;

export const getTableauAuthInfo = (authInfo: AuthInfo | undefined): TableauAuthInfo | undefined => {
  if (!authInfo) {
    return;
  }

  const tableauAuthInfo = tableauAuthInfoSchema.safeParse(authInfo.extra);
  if (!tableauAuthInfo.success) {
    return;
  }

  return tableauAuthInfo.data;
};
