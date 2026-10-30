import express from 'express';

import { getConfig } from '../../../config.js';
import { buildResourceIdentifier } from '../resourceIdentifier.js';
import { getSupportedScopes } from '../scopes.js';

/**
 * OAuth 2.0 Protected Resource Metadata
 *
 * Returns metadata about the protected resource and its
 * authorization servers. Client discovers this URL from
 * WWW-Authenticate header in 401 response.
 */
export function oauthProtectedResource(app: express.Application): void {
  app.get('/.well-known/oauth-protected-resource', async (_req, res) => {
    const { issuer, advertiseApiScopes, resourceUri } = getConfig().oauth;
    res.json({
      resource: buildResourceIdentifier(resourceUri),
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      // Advertise supported scopes regardless of enforceScopes. A client that sees an empty list
      // requests no scope, which the authorization server (Tableau, in delegated mode) rejects with
      // invalid_scope. Enforcing those scopes is a separate concern, handled at the request gate.
      scopes_supported: await getSupportedScopes({ includeApiScopes: advertiseApiScopes }),
    });
  });
}
