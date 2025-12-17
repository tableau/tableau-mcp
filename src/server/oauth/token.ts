import { KeyObject, randomBytes, timingSafeEqual } from 'crypto';
import express from 'express';
import { CompactEncrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error';

import { getConfig } from '../../config.js';
import { getTokenResult } from '../../sdks/tableau-oauth/methods.js';
import { TableauAccessToken } from '../../sdks/tableau-oauth/types.js';
import { getAuthorizationCodeStore, getRefreshTokenStore } from '../storage/stores.js';
import { generateCodeChallenge } from './generateCodeChallenge.js';
import { AUDIENCE } from './provider.js';
import { mcpTokenSchema } from './schemas.js';
import { ClientCredentials, UserAndTokens } from './types.js';

/**
 * OAuth 2.1 Token Endpoint
 *
 * Exchanges authorization code for access token.
 * Verifies PKCE code_verifier matches the original challenge.
 * Returns JWE containing tokens for API access.
 */
export function token(app: express.Application, publicKey: KeyObject): void {
  const config = getConfig();

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
          const authorizationCodeStore = await getAuthorizationCodeStore();
          const authCode = await authorizationCodeStore.get(code);
          if (!authCode || authCode.expiresAt < Math.floor(Date.now() / 1000)) {
            await authorizationCodeStore.delete(code);
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid or expired authorization code',
            });
            return;
          }

          // Verify PKCE
          const challengeFromVerifier = generateCodeChallenge(codeVerifier);
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
          const refreshTokenStore = await getRefreshTokenStore();
          await refreshTokenStore.set(
            refreshTokenId,
            {
              user: authCode.user,
              server: authCode.server,
              clientId: authCode.clientId,
              tokens: authCode.tokens,
              expiresAt: Math.floor(
                (Date.now() + (config.oauth.refreshTokenStorage.expirationTimeMs ?? 0)) / 1000,
              ),
              tableauClientId: authCode.tableauClientId,
            },
            config.oauth.refreshTokenStorage.expirationTimeMs,
          );

          await authorizationCodeStore.delete(code);

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            refresh_token: refreshTokenId,
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
          });
          return;
        }
        case 'refresh_token': {
          // Handle refresh token
          const { refreshToken } = result.data;
          const refreshTokenStore = await getRefreshTokenStore();
          const tokenData = await refreshTokenStore.get(refreshToken);
          if (!tokenData || tokenData.expiresAt < Math.floor(Date.now() / 1000)) {
            // Refresh token is expired
            await refreshTokenStore.delete(refreshToken);
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
            // which may or may not be expired.
            accessToken = await createAccessToken(
              {
                user: tokenData.user,
                clientId: tokenData.clientId,
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
                clientId: tokenData.clientId,
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

          // Rotate the refresh token and extend its expiration time
          await refreshTokenStore.delete(refreshToken);
          const refreshTokenId = randomBytes(32).toString('hex');

          await refreshTokenStore.set(
            refreshTokenId,
            {
              user: tokenData.user,
              server: tokenData.server,
              clientId: tokenData.clientId,
              tokens: tokenData.tokens,
              expiresAt: Math.floor(
                (Date.now() + (config.oauth.refreshTokenStorage.expirationTimeMs ?? 0)) / 1000,
              ),
              tableauClientId: tokenData.tableauClientId,
            },
            config.oauth.refreshTokenStorage.expirationTimeMs,
          );

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            refresh_token: refreshTokenId,
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
 * @param tokenData - token data
 * @param publicKey - public key for encrypting the token
 * @returns Encrypted JWE token for MCP authentication
 */
async function createAccessToken(tokenData: UserAndTokens, publicKey: KeyObject): Promise<string> {
  const config = getConfig();

  const payload = JSON.stringify({
    sub: tokenData.user.name,
    clientId: tokenData.clientId,
    tableauServer: tokenData.server,
    tableauUserId: tokenData.user.id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + config.oauth.accessTokenTimeoutMs) / 1000),
    aud: AUDIENCE,
    iss: config.oauth.issuer,
    ...(config.auth === 'oauth'
      ? {
          tableauAccessToken: tokenData.tokens.accessToken,
          tableauRefreshToken: tokenData.tokens.refreshToken,
          tableauExpiresAt: Math.floor(Date.now() / 1000) + tokenData.tokens.expiresInSeconds,
          tableauUserId: tokenData.user.id,
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
    clientId: clientCredentials.clientId,
    tableauServer: clientCredentials.server,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + config.oauth.accessTokenTimeoutMs) / 1000),
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
  } catch {
    return Err('Failed to exchange refresh token');
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
  if (!expectedClientSecret || clientSecret.length !== expectedClientSecret.length) {
    return Err('Invalid client credentials');
  }

  const textEncoder = new TextEncoder();
  const clientSecretBuffer = textEncoder.encode(clientSecret);
  const expectedClientSecretBuffer = textEncoder.encode(expectedClientSecret);

  if (
    clientSecretBuffer.byteLength !== expectedClientSecretBuffer.byteLength ||
    !timingSafeEqual(clientSecretBuffer, expectedClientSecretBuffer)
  ) {
    return Err('Invalid client credentials');
  }

  return Ok({ clientId });
}
