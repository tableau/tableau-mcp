import { Err, Ok, Result } from 'ts-results-es';

import { AuthConfig } from '../../../sdks/tableau/authConfig.js';
import { getJwt } from '../../../utils/getJwt.js';

/** The Embedding API scope every embed JWT must carry. */
export const EMBED_SCOPE = 'tableau:views:embed';

export type EmbedTokenError = 'embed-token-not-available';

/**
 * Resolves a `tableau:views:embed` token for the embedded viz by signing with the
 * provided AuthConfig:
 *   - direct-trust: sign an embed JWT via getJwt with connected-app config.
 *   - uat: sign an embed JWT from the UAT RS256 key via getJwt.
 *   - pat: return not-available (caller must handle Bearer pass-through
 *     or oauth scenarios before calling this resolver).
 *
 * Always signs with the embed scope `tableau:views:embed`, overriding any scopes in
 * the AuthConfig (which are sign-in scopes, not embedding scopes).
 */
export async function resolveEmbedToken({
  authConfig,
}: {
  authConfig: AuthConfig;
}): Promise<Result<{ token: string }, EmbedTokenError>> {
  switch (authConfig.type) {
    case 'direct-trust': {
      const token = await getJwt({
        username: authConfig.username,
        config: {
          type: 'connected-app',
          clientId: authConfig.clientId,
          secretId: authConfig.secretId,
          secretValue: authConfig.secretValue,
        },
        scopes: new Set([EMBED_SCOPE]),
        additionalPayload: authConfig.additionalPayload,
      });
      return Ok({ token });
    }

    case 'uat': {
      const token = await getJwt({
        username: authConfig.username,
        config: {
          type: 'uat',
          tenantId: authConfig.tenantId,
          issuer: authConfig.issuer,
          usernameClaimName: authConfig.usernameClaimName,
          privateKey: authConfig.privateKey,
          keyId: authConfig.keyId,
        },
        scopes: new Set([EMBED_SCOPE]),
        additionalPayload: authConfig.additionalPayload,
      });
      return Ok({ token });
    }

    case 'pat':
      // PAT cannot sign embed tokens.
      return Err('embed-token-not-available');
  }
}
