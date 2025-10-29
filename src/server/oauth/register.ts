import express from 'express';

export function register(app: express.Application): void {
  /**
   * Dynamic Client Registration Endpoint
   *
   * @remarks
   * MCP OAuth Step 4: Dynamic Client Registration (Optional)
   *
   * Allows clients to dynamically register with the authorization
   * server. For public clients (like desktop apps), no client
   * secret is required - security comes from PKCE.
   */
  app.post('/oauth/register', express.json(), (req, res) => {
    const { redirect_uris } = req.body;

    const validatedRedirectUris = [];
    if (redirect_uris && Array.isArray(redirect_uris)) {
      for (const uri of redirect_uris) {
        if (typeof uri !== 'string') {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: 'redirect_uris must be an array of strings',
          });
          return;
        }

        // Validate using same security rules as authorization endpoint
        try {
          const url = new URL(uri);

          if (url.protocol === 'https:') {
            // Allow HTTPS URLs
            validatedRedirectUris.push(uri);
          } else if (url.protocol === 'http:') {
            if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
              res.status(400).json({
                error: 'invalid_redirect_uri',
                error_description: `Invalid redirect URI: ${uri}. HTTP URIs must be localhost or 127.0.0.1`,
              });
              return;
            }
            // Allow HTTP only for localhost
            validatedRedirectUris.push(uri);
          } else if (url.protocol.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:$/)) {
            // Allow custom schemes
            validatedRedirectUris.push(uri);
          } else {
            res.status(400).json({
              error: 'invalid_redirect_uri',
              error_description: `Invalid redirect URI: ${uri}. Must use HTTPS, localhost HTTP, or custom scheme`,
            });
            return;
          }
        } catch {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI format: ${uri}`,
          });
          return;
        }
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
