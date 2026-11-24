import express from 'express';

import { getConfig } from '../../config.js';
import { getScopeInfo } from './scopes.js';

/**
 * Lists the explicit scopes the server supports, so a client can request a subset of them even
 * when the protected-resource metadata advertises the MCP wildcard scope. Gated like
 * `scopes_supported`: no scopes when scopes are not enforced, and no API scopes when they are not
 * advertised.
 */
export function scopeInfo(app: express.Application): void {
  app.get('/scopeInfo', async (req, res) => {
    const { enforceScopes, advertiseApiScopes } = getConfig().oauth;
    if (!enforceScopes) {
      res.json({ mcpScopes: [], requiredApiScopes: [], optionalApiScopes: [] });
      return;
    }

    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined;
    const info = await getScopeInfo(clientId);
    res.json(advertiseApiScopes ? info : { ...info, requiredApiScopes: [], optionalApiScopes: [] });
  });
}
