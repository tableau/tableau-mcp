import { KeyObject } from 'crypto';
import express from 'express';
import { compactDecrypt } from 'jose';
import { z } from 'zod';
import { fromError } from 'zod-validation-error/v3';

import { mcpAccessTokenSchema, mcpAccessTokenUserOnlySchema } from './schemas.js';
import { RefreshTokenData } from './types.js';

/**
 * RFC 7009 Token Revocation Request schema
 */
const revokeSchema = z.object({
  token: z.string().min(1, 'token is required'),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
});

/**
 * OAuth 2.1 Token Revocation Endpoint (RFC 7009)
 *
 * Submitting a refresh token deletes it from the server. The client will receive
 * `invalid_grant` on any subsequent refresh attempt.
 *
 * Submitting a JWE access token decrypts it to extract the embedded Tableau session
 * token and server URL. The endpoint then calls Tableau's `/auth/signout` to invalidate
 * the upstream session (best-effort) and deletes any associated refresh tokens from the
 * server. The JWE itself is self-contained and remains structurally valid until `exp`,
 * but is functionally revoked because the Tableau session is dead and no new tokens
 * can be obtained without re-authenticating.
 *
 * Token type routing:
 *   - `token_type_hint=refresh_token`: try refresh token first, then access token
 *   - `token_type_hint=access_token`: try access token first, then refresh token
 *   - No hint: try refresh token first (cheaper), then access token
 *
 * Unknown, malformed, or already-revoked tokens always return 200 per RFC 7009
 * Section 2.2, which intentionally avoids disclosing whether a token was valid.
 */
export function revoke(
  app: express.Application,
  refreshTokens: Map<string, RefreshTokenData>,
  privateKey: KeyObject,
  refreshTokenIndex: Map<string, string>,
): void {
  app.post('/oauth2/revoke', async (req, res) => {
    const result = revokeSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: fromError(result.error).toString(),
      });
      return;
    }

    const { token, token_type_hint } = result.data;

    if (token_type_hint === 'access_token') {
      await tryRevokeAccessToken(token, privateKey, refreshTokens, refreshTokenIndex);
      tryRevokeRefreshToken(token, refreshTokens, refreshTokenIndex);
    } else {
      // hint=refresh_token or no hint: try refresh token first (O(1) Map lookup),
      // then fall through to JWE decryption
      const revokedAsRefresh = tryRevokeRefreshToken(token, refreshTokens, refreshTokenIndex);
      if (!revokedAsRefresh) {
        await tryRevokeAccessToken(token, privateKey, refreshTokens, refreshTokenIndex);
      }
    }

    // RFC 7009 Section 2.2: always return 200 regardless of outcome
    res.status(200).json({});
  });
}

/**
 * Attempts to revoke a refresh token by removing it from the in-memory Map.
 * Also removes the corresponding entry from the secondary index.
 * Returns true if the token was found and deleted.
 */
function tryRevokeRefreshToken(
  token: string,
  refreshTokens: Map<string, RefreshTokenData>,
  refreshTokenIndex: Map<string, string>,
): boolean {
  const data = refreshTokens.get(token);
  if (!data) return false;
  refreshTokenIndex.delete(data.tokens.accessToken);
  refreshTokens.delete(token);
  return true;
}

/**
 * Attempts to revoke a JWE access token.
 *
 * If the JWE decrypts successfully and contains a Tableau session token
 * (`tableauAccessToken`) and server URL (`tableauServer`), calls Tableau's
 * `/auth/signout` endpoint to invalidate the upstream session (best-effort).
 * Also deletes any refresh tokens from the Map that are associated with the
 * same Tableau session token.
 *
 * Returns silently if the token is not a valid JWE or does not contain Tableau
 * credentials — per RFC 7009, callers always receive 200.
 */
async function tryRevokeAccessToken(
  token: string,
  privateKey: KeyObject,
  refreshTokens: Map<string, RefreshTokenData>,
  refreshTokenIndex: Map<string, string>,
): Promise<void> {
  let tableauAccessToken: string | undefined;
  let tableauServer: string | undefined;

  try {
    const { plaintext } = await compactDecrypt(token, privateKey);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));

    // Try the full schema first: authorization-code tokens carry tableauAccessToken.
    const fullParsed = mcpAccessTokenSchema.safeParse(payload);
    if (fullParsed.success) {
      tableauServer = fullParsed.data.tableauServer;
      tableauAccessToken = fullParsed.data.tableauAccessToken;
    } else {
      // Fall back to the narrower schema: client-credentials tokens have tableauServer
      // but no tableauAccessToken, so there is no upstream session to sign out.
      const userOnlyParsed = mcpAccessTokenUserOnlySchema.safeParse(payload);
      if (!userOnlyParsed.success) {
        return;
      }
      tableauServer = userOnlyParsed.data.tableauServer;
    }
  } catch {
    // Not a valid JWE for this server — treat as unknown token, return 200 (RFC 7009)
    return;
  }

  // Delete any refresh token associated with the same Tableau session (O(1) via index)
  if (tableauAccessToken) {
    const refreshTokenId = refreshTokenIndex.get(tableauAccessToken);
    if (refreshTokenId) {
      refreshTokens.delete(refreshTokenId);
      refreshTokenIndex.delete(tableauAccessToken);
    }

    // Best-effort signout of the upstream Tableau session
    if (tableauServer) {
      try {
        await fetch(`${tableauServer}/api/3.24/auth/signout`, {
          method: 'POST',
          headers: { 'X-Tableau-Auth': tableauAccessToken },
        });
      } catch {
        // Signout is best-effort: network errors or already-invalid sessions are ignored
      }
    }
  }
}
