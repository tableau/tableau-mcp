import express from 'express';

import { getConfig } from '../../../config.js';

/**
 * OAuth 2.0 Authorization Server Metadata
 *
 * @remarks
 * MCP OAuth Step 3: Authorization Server Metadata
 *
 * Returns metadata about the authorization server including
 * available endpoints, supported flows, and capabilities.
 */
export function oauthAuthorizationServer(app: express.Application): void {
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const origin = getConfig().oauth.issuer;
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:tools:tableau:read'],
      token_endpoint_auth_methods_supported: ['none'],
      subject_types_supported: ['public'],
    });
  });
}
