import { randomBytes } from 'crypto';
import express from 'express';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error';

import { getConfig } from '../../config.js';
import RestApi from '../../sdks/tableau/restApi.js';
import { getTokenResult } from '../../sdks/tableau-oauth/methods.js';
import { TableauAccessToken } from '../../sdks/tableau-oauth/types.js';
import { TABLEAU_CLOUD_SERVER_URL } from './provider.js';
import { callbackSchema } from './schemas.js';
import { AuthorizationCode, PendingAuthorization } from './types.js';

/**
 * OAuth Callback Handler
 *
 * Receives callback from Tableau OAuth after user authorization.
 * Exchanges code for tokens, generates MCP authorization
 * code, and redirects back to client with code.
 */
export function callback(
  app: express.Application,
  pendingAuthorizations: Map<string, PendingAuthorization>,
  authorizationCodes: Map<string, AuthorizationCode>,
): void {
  const config = getConfig();

  app.get('/Callback', async (req, res) => {
    const result = callbackSchema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: fromError(result.error).toString(),
      });
      return;
    }

    const { error, code, state } = result.data;

    if (error) {
      res.status(400).json({
        error: 'access_denied',
        error_description: 'User denied authorization',
      });
      return;
    }

    try {
      // Parse state to get auth key and Tableau state
      const [authKey, tableauState] = state?.split(':') ?? [];
      const pendingAuth = pendingAuthorizations.get(authKey);

      if (!pendingAuth || pendingAuth.tableauState !== tableauState) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Invalid state parameter',
        });
        return;
      }

      const tokensResult = await exchangeAuthorizationCode({
        server: config.server || TABLEAU_CLOUD_SERVER_URL,
        code: code ?? '',
        redirectUri: config.oauth.redirectUri,
        clientId: pendingAuth.tableauClientId,
        codeVerifier: pendingAuth.codeChallenge,
      });

      if (tokensResult.isErr()) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: tokensResult.error,
        });
        return;
      }

      const { accessToken, refreshToken, expiresInSeconds, originHost } = tokensResult.value;
      const originHostUrl = new URL(`https://${originHost}`);

      if (config.server) {
        const configServerUrl = new URL(config.server);
        if (originHostUrl.hostname !== configServerUrl.hostname) {
          // Not sure if this can actually happen but without returning an error here,
          // this would fail downstream when attempting to authenticate to the REST API.
          res.status(400).json({
            error: 'invalid_request',
            error_description: `Invalid origin host: ${originHost}. Expected: ${new URL(config.server).hostname}`,
          });
          return;
        }
      }

      const server = originHostUrl.toString();
      const restApi = new RestApi(server);
      restApi.setCredentials(accessToken, 'unknown user id');
      const sessionResult = await restApi.serverMethods.getCurrentServerSession();
      if (sessionResult.isErr()) {
        if (sessionResult.error.type === 'unauthorized') {
          res.status(401).json({
            error: 'unauthorized',
            error_description: `Unable to get the Tableau server session. Error: ${JSON.stringify(sessionResult.error)}`,
          });
        } else {
          res.status(500).json({
            error: 'server_error',
            error_description:
              'Internal server error during authorization. Unable to get the Tableau server session. Contact your administrator.',
          });
        }
        return;
      }

      // Generate authorization code
      const authorizationCode = randomBytes(32).toString('hex');
      authorizationCodes.set(authorizationCode, {
        clientId: pendingAuth.clientId,
        redirectUri: pendingAuth.redirectUri,
        codeChallenge: pendingAuth.codeChallenge,
        user: sessionResult.value.user,
        server,
        tableauClientId: pendingAuth.tableauClientId,
        tokens: {
          accessToken,
          refreshToken,
          expiresInSeconds,
        },
        expiresAt: Date.now() + config.oauth.authzCodeTimeoutMs,
      });

      // Clean up
      pendingAuthorizations.delete(authKey);

      // Redirect back to client with authorization code
      const redirectUrl = new URL(pendingAuth.redirectUri);
      redirectUrl.searchParams.set('code', authorizationCode);
      redirectUrl.searchParams.set('state', pendingAuth.state);

      res.redirect(redirectUrl.toString());
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.status(500).json({
        error: 'server_error',
        error_description:
          'Internal server error during authorization. Contact your administrator.',
      });
    }
  });
}

/**
 * Exchanges authorization code for Tableau access tokens
 *
 * @param server - Tableau server host
 * @param code - Authorization code
 * @param redirectUri - Redirect URI used in initial request
 * @param clientId - Client ID
 * @param codeVerifier - Code verifier
 * @returns token response with access_token and refresh_token
 */
async function exchangeAuthorizationCode({
  server,
  code,
  redirectUri,
  clientId,
  codeVerifier,
}: {
  server: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
}): Promise<Result<TableauAccessToken, string>> {
  try {
    const result = await getTokenResult(server, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    return Ok(result);
  } catch {
    return Err('Failed to exchange authorization code');
  }
}
