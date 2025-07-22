import { z } from 'zod';

export const mcpAuthorizeSchema = z
  .object({
    client_id: z.string().nonempty(),
    redirect_uri: z.string().nonempty(),
    response_type: z.string().nonempty(),
    code_challenge: z.string().nonempty(),
    code_challenge_method: z.string().nonempty(),
    state: z.string().nonempty(),
    scope: z.string(),
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
