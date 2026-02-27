import express from 'express';

import { getConfig } from '../../../config.js';
import { getSupportedScopes } from '../scopes.js';

/**
 * OAuth 2.0 Authorization Server Metadata
 *
 * Returns metadata about the authorization server including
 * available endpoints, supported flows, and capabilities.
 */
export function oauthAuthorizationServer(app: express.Application): void {
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const { issuer, advertiseApiScopes, enforceScopes } = getConfig().oauth;
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      registration_endpoint: `${issuer}/oauth2/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: enforceScopes
        ? getSupportedScopes({ includeApiScopes: advertiseApiScopes })
        : [],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      subject_types_supported: ['public'],
      client_id_metadata_document_supported: true,
    });
  });
}
