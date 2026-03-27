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
    const {
      issuer,
      advertiseApiScopes,
      enforceScopes,
      clientIdSecretPairs,
      embeddedAuthzServer,
    } = getConfig().oauth;

    const grant_types_supported = ['authorization_code', 'refresh_token'];
    const token_endpoint_auth_methods_supported = ['none'];

    if (clientIdSecretPairs) {
      grant_types_supported.push('client_credentials');
      token_endpoint_auth_methods_supported.push('client_secret_basic');
      token_endpoint_auth_methods_supported.push('client_secret_post');
    }

    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      registration_endpoint: `${issuer}/oauth2/register`,
      // revocation_endpoint is only available in embedded authorization server mode.
      // In Tableau authorization server mode (OAUTH_EMBEDDED_AUTHZ_SERVER=false),
      // the MCP server does not issue tokens and therefore does not implement revocation.
      ...(embeddedAuthzServer ? { revocation_endpoint: `${issuer}/oauth2/revoke` } : {}),
      response_types_supported: ['code'],
      grant_types_supported,
      code_challenge_methods_supported: ['S256'],
      scopes_supported: enforceScopes
        ? getSupportedScopes({ includeApiScopes: advertiseApiScopes })
        : [],
      token_endpoint_auth_methods_supported,
      subject_types_supported: ['public'],
      client_id_metadata_document_supported: true,
    });
  });
}
