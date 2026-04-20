import { KeyObject, randomBytes, timingSafeEqual } from 'crypto';
import express from 'express';
import { CompactEncrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import { getConfig } from '../../config.web.js';
import { getTokenResult } from '../../sdks/tableau-oauth/methods.js';
import { TableauAccessToken } from '../../sdks/tableau-oauth/types.js';
import { getSiteLuidFromAccessToken } from '../../utils/getSiteLuidFromAccessToken.js';
import { setLongTimeout } from '../../utils/setLongTimeout.js';
import { generateCodeChallenge } from './generateCodeChallenge.js';
import { mcpTokenSchema } from './schemas.js';
import { formatScopes, getSupportedScopes, parseScopes, validateScopes } from './scopes.js';
import { AuthorizationCode, ClientCredentials, RefreshTokenData, UserAndTokens } from './types.js';

export const AUDIENCE = 'tableau-mcp-server';

/**
 * OAuth 2.1 Token Endpoint
 *
 * Exchanges authorization code for access token.
 * Verifies PKCE code_verifier matches the original challenge.
 * Returns JWE containing tokens for API access.
 */
export function token(
  app: express.Application,
  authorizationCodes: Map<string, AuthorizationCode>,
  refreshTokens: Map<string, RefreshTokenData>,
  publicKey: KeyObject,
  refreshTokenIndex: Map<string, string>,
): void {
  const config = getConfig();

  app.post('/oauth2/token', async (req, res) => {
    const result = mcpTokenSchema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: fromError(result.error).toString(),
      });
      return;
    }

    let clientCredentialClientId = '';
    if (config.oauth.clientIdSecretPairs) {
      const clientCredentialsResult = verifyClientCredentials({
        clientId: result.data.clientId,
        clientSecret: result.data.clientSecret,
        clientIdSecretPairs: config.oauth.clientIdSecretPairs,
        authorizationHeader: req.headers.authorization,
      });

      if (clientCredentialsResult.isErr()) {
        res.status(401).json({
          error: 'invalid_client',
          error_description: clientCredentialsResult.error,
        });
        return;
      }

      clientCredentialClientId = clientCredentialsResult.value.clientId;
    }

    try {
      switch (result.data.grantType) {
        case 'authorization_code': {
          // Handle authorization code exchange
          const { code, codeVerifier } = result.data;
          const authCode = authorizationCodes.get(code);
          if (!authCode || authCode.expiresAt < Math.floor(Date.now() / 1000)) {
            authorizationCodes.delete(code);
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

          // Validate redirect_uri matches what was used at authorization (OAuth 2.1 Section 4.1.3)
          if (result.data.redirectUri !== authCode.redirectUri) {
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Redirect URI mismatch',
            });
            return;
          }

          // Validate client_id matches what was used at authorization (when provided).
          // Fall back to the credential-verified identity from the Basic Auth path.
          const effectiveClientId = result.data.clientId || clientCredentialClientId || undefined;
          if (effectiveClientId && effectiveClientId !== authCode.clientId) {
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Client ID mismatch',
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
            scopes: authCode.scopes,
            siteContentUrl: authCode.siteContentUrl,
            expiresAt: Math.floor((Date.now() + config.oauth.refreshTokenTimeoutMs) / 1000),
            tableauClientId: authCode.tableauClientId,
          });
          refreshTokenIndex.set(authCode.tokens.accessToken, refreshTokenId);

          setLongTimeout(
            () => refreshTokens.delete(refreshTokenId),
            config.oauth.refreshTokenTimeoutMs,
          );

          authorizationCodes.delete(code);

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            refresh_token: refreshTokenId,
            scope: formatScopes(authCode.scopes),
          });
          return;
        }
        case 'client_credentials': {
          const { enforceScopes, advertiseApiScopes } = config.oauth;
          const requestedScopes = parseScopes(result.data.scope);
          const { valid: validScopes, invalid: invalidScopes } = validateScopes(
            requestedScopes,
            getSupportedScopes({ includeApiScopes: advertiseApiScopes }),
          );

          if (invalidScopes.length > 0) {
            res.status(400).json({
              error: 'invalid_scope',
              error_description: `Unsupported scopes: ${invalidScopes.join(', ')}`,
            });
            return;
          }

          const scopesToGrant =
            validScopes.length > 0
              ? validScopes
              : enforceScopes
                ? getSupportedScopes({ includeApiScopes: advertiseApiScopes })
                : [];

          // Generate access token for client credentials grant type.
          // Refresh token is not supported for client credentials grant type.
          // https://www.rfc-editor.org/rfc/rfc6749#section-4.4.3
          const accessToken = await createClientCredentialsAccessToken(
            {
              clientId: clientCredentialClientId,
              server: config.server,
            },
            scopesToGrant,
            publicKey,
          );

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            scope: formatScopes(scopesToGrant),
          });
          return;
        }
        case 'refresh_token': {
          // Handle refresh token
          const { refreshToken } = result.data;
          const tokenData = refreshTokens.get(refreshToken);
          if (!tokenData || tokenData.expiresAt < Math.floor(Date.now() / 1000)) {
            // Refresh token is expired
            if (tokenData) refreshTokenIndex.delete(tokenData.tokens.accessToken);
            refreshTokens.delete(refreshToken);
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid or expired refresh token',
            });
            return;
          }

          let accessToken: string;
          let tokensToStore = tokenData.tokens;
          const { refreshToken: tableauRefreshToken } = tokenData.tokens;

          const tokensResult = await exchangeRefreshToken(
            tokenData.server,
            tableauRefreshToken,
            tokenData.tableauClientId,
            tokenData.siteContentUrl,
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
                scopes: tokenData.scopes,
                siteContentUrl: tokenData.siteContentUrl,
              },
              publicKey,
            );
          } else {
            const {
              accessToken: newTableauAccessToken,
              refreshToken: newTableauRefreshToken,
              expiresInSeconds,
            } = tokensResult.value;

            tokensToStore = {
              accessToken: newTableauAccessToken,
              refreshToken: newTableauRefreshToken,
              expiresInSeconds,
            };

            accessToken = await createAccessToken(
              {
                user: tokenData.user,
                clientId: tokenData.clientId,
                server: tokenData.server,
                tokens: tokensToStore,
                scopes: tokenData.scopes,
                siteContentUrl: tokenData.siteContentUrl,
              },
              publicKey,
            );
          }

          // Rotate the refresh token and extend its expiration time
          refreshTokenIndex.delete(tokenData.tokens.accessToken);
          refreshTokens.delete(refreshToken);
          const refreshTokenId = randomBytes(32).toString('hex');

          refreshTokens.set(refreshTokenId, {
            user: tokenData.user,
            server: tokenData.server,
            clientId: tokenData.clientId,
            tokens: tokensToStore,
            scopes: tokenData.scopes,
            siteContentUrl: tokenData.siteContentUrl,
            expiresAt: Math.floor((Date.now() + config.oauth.refreshTokenTimeoutMs) / 1000),
            tableauClientId: tokenData.tableauClientId,
          });
          refreshTokenIndex.set(tokensToStore.accessToken, refreshTokenId);

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: config.oauth.accessTokenTimeoutMs / 1000,
            refresh_token: refreshTokenId,
            scope: formatScopes(tokenData.scopes),
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
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + config.oauth.accessTokenTimeoutMs) / 1000),
    aud: AUDIENCE,
    iss: config.oauth.issuer,
    scope: formatScopes(tokenData.scopes),
    ...(config.auth === 'oauth'
      ? {
          tableauAccessToken: tokenData.tokens.accessToken,
          tableauRefreshToken: tokenData.tokens.refreshToken,
          tableauExpiresAt: Math.floor(Date.now() / 1000) + tokenData.tokens.expiresInSeconds,
          tableauUserId: tokenData.user.id,
          tableauSiteId: getSiteLuidFromAccessToken(tokenData.tokens.accessToken),
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
  scopes: string[],
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
    scope: formatScopes(scopes),
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
  siteContentUrl: string,
): Promise<Result<TableauAccessToken, string>> {
  try {
    const result = await getTokenResult(
      server,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        site_namespace: siteContentUrl,
      },
      {
        timeout: getConfig().maxRequestTimeoutMs,
      },
    );

    return Ok(result);
  } catch {
    return Err('Failed to exchange refresh token');
  }
}

function verifyClientCredentials({
  clientId,
  clientSecret,
  clientIdSecretPairs,
  authorizationHeader,
}: {
  clientId: string | undefined;
  clientSecret: string | undefined;
  clientIdSecretPairs: Record<string, string> | null;
  authorizationHeader: string | undefined;
}): Result<{ clientId: string }, string> {
  if (!clientId && !clientSecret) {
    if (!authorizationHeader) {
      return Err('Authorization header is required');
    }

    const [type, credentials] = authorizationHeader.split(' ');
    if (type !== 'Basic') {
      return Err('Invalid authorization type');
    }

    if (!credentials) {
      return Err('Invalid client credentials');
    }

    [clientId, clientSecret] = Buffer.from(credentials, 'base64').toString().split(':');
    if (!clientId || !clientSecret) {
      return Err('Invalid client credentials');
    }
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
