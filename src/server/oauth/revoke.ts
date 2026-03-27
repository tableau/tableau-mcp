import express from 'express';
import { z } from 'zod';
import { fromError } from 'zod-validation-error/v3';

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
 * Semantics implemented: refresh-grant revocation only.
 *
 * Submitting a refresh token deletes it from the server. The client will receive
 * `invalid_grant` on any subsequent refresh attempt.
 *
 * Submitting anything else — including a valid access token — returns 200 without
 * taking any action. Access tokens in this system are self-contained JWE blobs; there
 * is no server-side state for issued access tokens and no jti claim to correlate a
 * token to a specific grant. Immediate access token invalidation is not implemented
 * in this release. An access token continues to work until its `exp` claim passes
 * (default: 1 hour). To revoke the associated grant, submit the refresh token instead.
 *
 * Unknown, malformed, or already-revoked tokens always return 200 per RFC 7009
 * Section 2.2, which intentionally avoids disclosing whether a token was valid.
 *
 * This endpoint is only available in embedded authorization server mode
 * (OAUTH_EMBEDDED_AUTHZ_SERVER=true). It is not available in Tableau authorization
 * server mode because the MCP server does not issue tokens in that configuration.
 */
export function revoke(
  app: express.Application,
  refreshTokens: Map<string, RefreshTokenData>,
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

    const { token } = result.data;

    // Refresh tokens are 32-byte random hex strings stored as Map keys.
    // Access tokens are JWE compact serializations (base64url.base64url.base64url).
    // The Map lookup is O(1) and sufficient to distinguish them — if the token is
    // in the Map, it is a refresh token and we revoke it. Otherwise we return 200
    // without taking any action (RFC 7009 Section 2.2 requires 200 for all cases,
    // including invalid or already-revoked tokens, to avoid token enumeration).
    if (refreshTokens.has(token)) {
      refreshTokens.delete(token);
    }

    // RFC 7009 Section 2.2: "The authorization server responds with HTTP status
    // code 200 if the token has been revoked successfully or if the client submitted
    // an invalid token."
    res.status(200).json({});
  });
}
