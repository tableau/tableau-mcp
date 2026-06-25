import { Err, Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import { TableauAuthInfo } from '../../../server/oauth/schemas.js';
import { getJwt } from '../../../utils/getJwt.js';

/** The Embedding API scope every embed JWT must carry. */
export const EMBED_SCOPE = 'tableau:views:embed';

export type EmbedTokenError = 'embed-token-not-available';

/** The slice of Config the resolver needs (keeps it trivially testable). */
export type EmbedTokenConfig = Pick<
  Config,
  | 'auth'
  | 'connectedAppClientId'
  | 'connectedAppSecretId'
  | 'connectedAppSecretValue'
  | 'jwtUsername'
>;

/**
 * Resolves a `tableau:views:embed` token for the embedded viz, in priority order:
 *   1. A Tableau-signed Bearer JWT is present (http + Tableau-authz + AUTH=oauth) -> pass it through.
 *   2. direct-trust signing material is present -> sign an embed JWT via getJwt.
 *   3. Nothing available -> typed not-available (the app skips embedding).
 *
 * Gating on the Bearer token *type* (not on config.auth) is deliberate: under
 * embedded-authz the stashed token is X-Tableau-Auth, not a Bearer JWT, so step 1
 * correctly does not fire there.
 */
export async function resolveEmbedToken({
  config,
  tableauAuthInfo,
}: {
  config: EmbedTokenConfig;
  tableauAuthInfo: TableauAuthInfo | undefined;
}): Promise<Result<{ token: string }, EmbedTokenError>> {
  // 1. Pass-through Bearer JWT.
  if (tableauAuthInfo?.type === 'Bearer') {
    return Ok({ token: tableauAuthInfo.raw });
  }

  // 2. direct-trust: sign an embed JWT from the existing Connected App secret.
  if (
    config.auth === 'direct-trust' &&
    config.connectedAppClientId &&
    config.connectedAppSecretId &&
    config.connectedAppSecretValue &&
    config.jwtUsername
  ) {
    const token = await getJwt({
      username: config.jwtUsername,
      config: {
        type: 'connected-app',
        clientId: config.connectedAppClientId,
        secretId: config.connectedAppSecretId,
        secretValue: config.connectedAppSecretValue,
      },
      scopes: new Set([EMBED_SCOPE]),
    });
    return Ok({ token });
  }

  // 3. No material available.
  return Err('embed-token-not-available');
}
