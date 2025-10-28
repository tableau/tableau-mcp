import { KeyObject, randomBytes, timingSafeEqual } from 'crypto';
import express from 'express';
import { CompactEncrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error';

import { getConfig } from '../../config.js';
import { getTokenResult } from '../../sdks/tableau-oauth/methods.js';
import { TableauAccessToken } from '../../sdks/tableau-oauth/types.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { isAxiosError } from '../../utils/isAxiosError.js';
import { generateCodeChallenge } from './generateCodeChallenge.js';
import { AUDIENCE } from './provider.js';
import { mcpTokenSchema } from './schemas.js';
import { AuthorizationCode, ClientCredentials, RefreshTokenData, UserAndTokens } from './types.js';

export function token(
  app: express.Application,
  authorizationCodes: Map<string, AuthorizationCode>,
  refreshTokens: Map<string, RefreshTokenData>,
  publicKey: KeyObject,
): void {
  const config = getConfig();

  /**
   * OAuth 2.1 Token Endpoint
   *
   * @remarks
   * MCP OAuth Step 7: Token Exchange with PKCE Verification
   *
   * Exchanges authorization code for access token.
   * Verifies PKCE code_verifier matches the original challenge.
   * Returns JWT containing tokens for API access.
   */
  app.post('/oauth/token', async (req, res) => {
    const result = mcpTokenSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: fromError(result.error).toString(),
      });
      return;
    }

    const clientCredentialsResult = verifyClientCredentials({
      required: result.data.grantType === 'client_credentials',
      clientId: result.data.clientId,
      clientSecret: result.data.clientSecret,
      clientIdSecretPairs: getConfig().oauth.clientIdSecretPairs,
      authorizationHeader: req.headers.authorization,
    });

    if (clientCredentialsResult.isErr()) {
      res.status(401).json({
        error: 'invalid_client',
        error_description: clientCredentialsResult.error,
      });
      return;
    }

    try {
      switch (result.data.grantType) {
        case 'authorization_code': {
          // Handle authorization code exchange
          const { code, codeVerifier } = result.data;
          const authCode = authorizationCodes.get(code);
          if (!authCode || authCode.expiresAt < Date.now()) {
            authorizationCodes.delete(code);
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid or expired authorization code',
            });
            return;
          }

          // Verify PKCE
          const challengeFromVerifier = generateCodeChallenge(codeVerifier);
          console.log('debug remove -- challengeFromVerifier', challengeFromVerifier);
          console.log('debug remove -- authCode.codeChallenge', authCode.codeChallenge);
          if (challengeFromVerifier !== authCode.codeChallenge) {
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid code verifier',
            });
            return;
          }

          // Generate tokens
          const refreshTokenId = randomBytes(32).toString('hex');
          const accessToken = await createAccessToken(authCode, publicKey);
          refreshTokens.set(refreshTokenId, {
            user: authCode.user,
            server: authCode.server,
            clientId: authCode.clientId,
            tokens: authCode.tokens,
            expiresAt: Date.now() + config.oauth.refreshTokenTimeoutMs,
            tableauClientId: authCode.tableauClientId,
          });

          setTimeout(
            () => refreshTokens.delete(refreshTokenId),
            config.oauth.refreshTokenTimeoutMs,
          );

          authorizationCodes.delete(code);

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            refresh_token: refreshTokenId,
            scope: 'read',
          });
          return;
        }
        case 'client_credentials': {
          // Generate access token for client credentials grant type.
          // Refresh token is not supported for client credentials grant type.
          // https://www.rfc-editor.org/rfc/rfc6749#section-4.4.3
          const accessToken = await createClientCredentialsAccessToken(
            {
              clientId: clientCredentialsResult.value.clientId,
              server: config.server,
            },
            publicKey,
          );

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            scope: 'read',
          });
          return;
        }
        case 'refresh_token': {
          // Handle refresh token
          const { refreshToken } = result.data;
          const tokenData = refreshTokens.get(refreshToken);
          if (!tokenData || tokenData.expiresAt < Date.now()) {
            // Refresh token is expired
            refreshTokens.delete(refreshToken);
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid or expired refresh token',
            });
            return;
          }

          let accessToken: string;
          const { refreshToken: tableauRefreshToken } = tokenData.tokens;

          const tokensResult = await exchangeRefreshToken(
            tokenData.server,
            tableauRefreshToken,
            tokenData.tableauClientId,
          );

          if (tokensResult.isErr()) {
            // If the refresh token exchange fails, reuse the existing Tableau access token
            // which may nor may not be expired.
            accessToken = await createAccessToken(
              {
                user: tokenData.user,
                server: tokenData.server,
                tokens: tokenData.tokens,
              },
              publicKey,
            );
          } else {
            const {
              accessToken: newTableauAccessToken,
              refreshToken: newTableauRefreshToken,
              expiresInSeconds,
            } = tokensResult.value;

            accessToken = await createAccessToken(
              {
                user: tokenData.user,
                server: tokenData.server,
                tokens: {
                  accessToken: newTableauAccessToken,
                  refreshToken: newTableauRefreshToken,
                  expiresInSeconds,
                },
              },
              publicKey,
            );
          }

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            scope: 'read',
          });
          return;
        }
      }
    } catch (error) {
      console.error('Token endpoint error:', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error',
      });
      return;
    }
  });
}

/**
 * Creates JWE access token containing credentials
 *
 * @remarks
 * Part of MCP OAuth Step 7: Token Exchange
 * JWE contains tokens for making API calls
 *
 * @param tokenData - token data
 * @returns Encrypted JWE token for MCP authentication
 */
async function createAccessToken(tokenData: UserAndTokens, publicKey: KeyObject): Promise<string> {
  const config = getConfig();

  const payload = JSON.stringify({
    sub: tokenData.user.name,
    tableauServer: tokenData.server,
    tableauUserId: tokenData.user.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Date.now() + config.oauth.accessTokenTimeoutMs,
    aud: AUDIENCE,
    iss: config.oauth.issuer,
    ...(config.auth === 'oauth'
      ? {
          tableauAccessToken: tokenData.tokens.accessToken,
          tableauRefreshToken: tokenData.tokens.refreshToken,
          tableauExpiresAt: Date.now() + tokenData.tokens.expiresInSeconds * 1000,
        }
      : {}),
  });

  const jwe = await new CompactEncrypt(new TextEncoder().encode(payload))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
    .encrypt(publicKey);

  return jwe;
}

async function createClientCredentialsAccessToken(
  clientCredentials: ClientCredentials,
  publicKey: KeyObject,
): Promise<string> {
  const config = getConfig();
  const payload = JSON.stringify({
    sub: clientCredentials.clientId,
    tableauServer: clientCredentials.server,
    iat: Math.floor(Date.now() / 1000),
    exp: Date.now() + config.oauth.accessTokenTimeoutMs,
    aud: AUDIENCE,
    iss: config.oauth.issuer,
  });

  const jwe = await new CompactEncrypt(new TextEncoder().encode(payload))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
    .encrypt(publicKey);

  return jwe;
}

async function exchangeRefreshToken(
  server: string,
  refreshToken: string,
  clientId: string,
): Promise<Result<TableauAccessToken, string>> {
  try {
    const result = await getTokenResult(server, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      site_namespace: '',
    });

    return Ok(result);
  } catch (error) {
    if (!isAxiosError(error) || !error.response) {
      return Err(`Failed to exchange refresh token: ${getExceptionMessage(error)}`);
    }

    const errorText = JSON.stringify(error.response.data);
    return Err(`Failed to exchange refresh token: ${error.response.status} - ${errorText}`);
  }
}

function verifyClientCredentials({
  required,
  clientId,
  clientSecret,
  clientIdSecretPairs,
  authorizationHeader,
}: {
  required: boolean;
  clientId: string | undefined;
  clientSecret: string | undefined;
  clientIdSecretPairs: Record<string, string> | null;
  authorizationHeader: string | undefined;
}): Result<{ clientId: string }, string> {
  if (!clientId && !clientSecret) {
    if (required) {
      if (!authorizationHeader) {
        return Err('Authorization header is required');
      }

      const [type, credentials] = authorizationHeader.split(' ');
      if (type !== 'Basic') {
        return Err('Invalid authorization type');
      }

      [clientId, clientSecret] = Buffer.from(credentials, 'base64').toString().split(':');
      if (!clientId || !clientSecret) {
        return Err('Invalid client credentials');
      }
    }
  }

  if (!required) {
    return Ok({ clientId: '' });
  }

  if (!clientId) {
    return Err('Client ID is required');
  }

  if (!clientSecret) {
    return Err('Client secret is required');
  }

  const expectedClientSecret = clientIdSecretPairs?.[clientId];
  const isMatch = expectedClientSecret
    ? timingSafeEqual(
        new TextEncoder().encode(clientSecret),
        new TextEncoder().encode(expectedClientSecret),
      )
    : false;

  if (!isMatch) {
    return Err('Invalid client credentials');
  }

  return Ok({ clientId });
}
