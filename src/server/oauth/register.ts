import express from 'express';

import { isValidRedirectUri } from './isValidRedirectUri.js';

/**
 * Dynamic Client Registration Endpoint
 *
 * Allows clients to dynamically register with the authorization
 * server. For public clients (like desktop apps), no client
 * secret is required - security comes from PKCE.
 */
export function register(app: express.Application): void {
  app.post('/oauth/register', express.json(), (req, res) => {
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

    // For public clients, we use a fixed client ID since no authentication is required
    // The security comes from PKCE (code challenge/verifier) at authorization time
    res.json({
      client_id: 'mcp-public-client',
      redirect_uris: validatedRedirectUris,
      grant_types: ['authorization_code', 'client_credentials'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: 'native',
    });
  });
}
