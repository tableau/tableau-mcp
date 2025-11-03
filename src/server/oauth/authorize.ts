import { randomBytes, randomUUID } from 'crypto';
import express from 'express';
import { fromError } from 'zod-validation-error';

import { getConfig } from '../../config.js';
import { setLongTimeout } from '../../utils/setLongTimeout.js';
import { generateCodeChallenge } from './generateCodeChallenge.js';
import { TABLEAU_CLOUD_SERVER_URL } from './provider.js';
import { mcpAuthorizeSchema } from './schemas.js';
import { PendingAuthorization } from './types.js';

export function authorize(
  app: express.Application,
  pendingAuthorizations: Map<string, PendingAuthorization>,
): void {
  const config = getConfig();

  /**
   * OAuth 2.1 Authorization Endpoint
   *
   * Handles authorization requests with PKCE parameters.
   * Validates request, stores pending authorization, and
   * redirects to Tableau OAuth.
   */
  app.get('/oauth/authorize', (req, res) => {
    const result = mcpAuthorizeSchema.safeParse(req.query);

    if (!result.success) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: fromError(result.error).toString(),
      });
      return;
    }

    const {
      clientId,
      redirectUri,
      responseType,
      codeChallenge,
      codeChallengeMethod,
      state,
      scope = 'read',
    } = result.data;

    if (responseType !== 'code') {
      res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only authorization code flow is supported',
      });
      return;
    }

    if (codeChallengeMethod !== 'S256') {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Only S256 code challenge method is supported',
      });
      return;
    }

    // Validate redirect URI using security rules (for public clients)
    try {
      const url = new URL(redirectUri);

      // Allow HTTPS URLs
      if (url.protocol === 'https:') {
        // HTTPS is always allowed
      }
      // Allow HTTP only for localhost
      else if (url.protocol === 'http:') {
        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
          throw new Error('Invalid hostname over http');
        }

        // Localhost HTTP is allowed
      }
      // Allow custom schemes (like systemprompt://)
      else if (url.protocol.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:$/)) {
        // Custom schemes are allowed
      } else {
        throw new Error('Invalid protocol');
      }
    } catch {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Invalid redirect URI: must use HTTPS, localhost HTTP, or custom scheme',
      });
      return;
    }

    // Generate Tableau state and store pending authorization
    const tableauState = randomBytes(32).toString('hex');
    const authKey = randomBytes(32).toString('hex');

    const tableauClientId = randomUUID();
    pendingAuthorizations.set(authKey, {
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      state: state ?? '',
      scope,
      tableauState,
      tableauClientId,
    });

    // Clean up expired authorizations
    setLongTimeout(() => pendingAuthorizations.delete(authKey), config.oauth.authzCodeTimeoutMs);

    // Redirect to Tableau OAuth
    const server = config.server || TABLEAU_CLOUD_SERVER_URL;
    const tableauCodeChallenge = generateCodeChallenge(codeChallenge);
    const oauthUrl = new URL(`${server}/oauth2/v1/auth`);
    oauthUrl.searchParams.set('client_id', tableauClientId);
    oauthUrl.searchParams.set('code_challenge', tableauCodeChallenge);
    oauthUrl.searchParams.set('code_challenge_method', codeChallengeMethod);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('redirect_uri', config.oauth.redirectUri);
    oauthUrl.searchParams.set('state', `${authKey}:${tableauState}`);
    oauthUrl.searchParams.set('device_id', randomUUID());
    oauthUrl.searchParams.set('target_site', config.siteName);
    oauthUrl.searchParams.set('device_name', getDeviceName(redirectUri, state ?? ''));
    oauthUrl.searchParams.set('client_type', 'tableau-mcp');

    res.redirect(oauthUrl.toString());
  });
}

function getDeviceName(redirectUri: string, state: string): string {
  const defaultDeviceName = 'tableau-mcp (Unknown agent)';

  try {
    const url = new URL(redirectUri);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      if (redirectUri === 'https://vscode.dev/redirect' && new URL(state).protocol === 'vscode:') {
        // VS Code normally authenticates in a way that doesn't give any clues about who it is.
        // It has a backup authentication method they call "URL Handler" that does though.
        return 'tableau-mcp (VS Code)';
      }

      return defaultDeviceName;
    } else if (url.protocol === 'cursor:') {
      return 'tableau-mcp (Cursor)';
    } else {
      return `tableau-mcp (${url.protocol.slice(0, -1)})`;
    }
  } catch {
    return defaultDeviceName;
  }
}
