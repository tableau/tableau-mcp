import express from 'express';

import { getConfig } from '../../../config.js';
import { serverName } from '../../../server.js';
import { getSupportedScopes } from '../scopes.js';

/**
 * OAuth 2.0 Protected Resource Metadata
 *
 * Returns metadata about the protected resource and its
 * authorization servers. Client discovers this URL from
 * WWW-Authenticate header in 401 response.
 */
export function oauthProtectedResource(app: express.Application): void {
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    const { issuer, advertiseApiScopes } = getConfig().oauth;
    res.json({
      resource: `${issuer}/${serverName}`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: getSupportedScopes({ includeApiScopes: advertiseApiScopes }),
    });
  });
}
