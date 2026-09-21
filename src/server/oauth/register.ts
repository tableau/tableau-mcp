import { randomUUID } from 'crypto';
import express from 'express';

import type { SessionStore } from '../../sessionStore/sessionStore.js';
import { isValidRedirectUri } from './isValidRedirectUri.js';
import { ClientRegistration } from './types.js';

/**
 * Dynamic Client Registration Endpoint
 *
 * Allows clients to dynamically register with the authorization
 * server. Redirect URIs are allowlisted per registered client and
 * enforced at authorize time, in addition to PKCE.
 */
export function register(
  app: express.Application,
  clientRegistrations: SessionStore<ClientRegistration>,
): void {
  app.post('/oauth2/register', express.json(), async (req, res) => {
    const { redirect_uris } = req.body;

    const validatedRedirectUris = [];
    if (redirect_uris && Array.isArray(redirect_uris)) {
      for (const uri of redirect_uris) {
        if (!isValidRedirectUri(uri)) {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI: ${uri}`,
          });
          return;
        }

        validatedRedirectUris.push(uri);
      }
    }

    let { token_endpoint_auth_method } = req.body;
    if (
      !token_endpoint_auth_method ||
      typeof token_endpoint_auth_method !== 'string' ||
      !['client_secret_basic', 'client_secret_post'].includes(token_endpoint_auth_method)
    ) {
      token_endpoint_auth_method = 'client_secret_basic';
    }

    // Mint a unique client ID and store the allowlisted redirect URIs
    const clientId = randomUUID();
    await clientRegistrations.set(clientId, {
      redirectUris: validatedRedirectUris,
    });

    res.json({
      client_id: clientId,
      redirect_uris: validatedRedirectUris,
      grant_types: ['authorization_code', 'client_credentials'],
      response_types: ['code'],
      token_endpoint_auth_method,
      application_type: 'native',
    });
  });
}
