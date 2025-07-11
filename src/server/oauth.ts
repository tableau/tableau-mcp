import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createHash, randomBytes } from 'crypto';
import express from 'express';
import { jwtVerify, SignJWT } from 'jose';

import { getConfig } from '../config.js';
import RestApi from '../sdks/tableau/restApi.js';
import { userAgent } from './userAgent.js';

type AuthenticatedRequest = express.Request & {
  auth?: AuthInfo;
};

type Tokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  tableauState: string;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  tokens: Tokens;
  expiresAt: number;
};

type RefreshTokenData = {
  userId: string;
  clientId: string;
  tokens: Tokens;
  expiresAt: number;
};

/**
 * OAuth 2.1 Provider
 *
 * @remarks
 * Implements the complete MCP OAuth 2.1 flow with PKCE
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
 *
 * This provider handles:
 * - Step 1: Initial 401 response with WWW-Authenticate
 * - Step 2: Resource metadata discovery
 * - Step 3: Authorization server metadata
 * - Step 4: Dynamic client registration
 * - Step 5: Authorization with PKCE
 * - Step 6: OAuth callback
 * - Step 7: Token exchange
 * - Step 8: Authenticated requests
 *
 * Security features:
 * - PKCE (RFC 7636) for authorization code flow
 * - Secure state parameter validation
 * - Time-limited authorization codes
 */
export class OAuthProvider {
  private readonly jwtSecret: Uint8Array;
  private readonly config = getConfig();
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();
  private readonly authorizationCodes = new Map<string, AuthorizationCode>();
  private readonly refreshTokens = new Map<string, RefreshTokenData>();

  private readonly jwtAudience: string;
  private readonly jwtIssuer: string;
  private readonly AUTHORIZATION_CODE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private readonly REFRESH_TOKEN_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor() {
    this.jwtSecret = new TextEncoder().encode(this.config.jwtSecret);
    this.jwtAudience = 'tableau-mcp-server';
    this.jwtIssuer = this.config.oauthIssuer;
  }

  /**
   * Express middleware for OAuth authentication
   *
   * @remarks
   * MCP OAuth Step 1: Initial Request (401 Unauthorized)
   *
   * This middleware checks for Bearer token authorization.
   * If no token is present, returns 401 with WWW-Authenticate header
   * pointing to resource metadata endpoint.
   *
   * @returns Express middleware function
   */
  authMiddleware() {
    return async (
      req: AuthenticatedRequest,
      res: express.Response,
      next: express.NextFunction,
    ): Promise<void> => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // For SSE requests (GET), provide proper SSE error response
        if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(401, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write('event: error\n');
          res.write(
            'data: {"error": "unauthorized", "error_description": "Authorization required"}\n\n',
          );
          res.end();
          return;
        }

        const baseUrl = `https://${req.get('host')}`;
        res
          .status(401)
          .header(
            'WWW-Authenticate',
            `Bearer realm="MCP", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
          )
          .json({
            error: 'unauthorized',
            error_description: 'Authorization required. Use OAuth 2.1 flow.',
          });
        return;
      }

      const token = authHeader.slice(7);

      try {
        req.auth = await this.verifyAccessToken(token);
        next();
      } catch {
        // For SSE requests (GET), provide proper SSE error response
        if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(401, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write('event: error\n');
          res.write(
            'data: {"error": "invalid_token", "error_description": "Invalid or expired access token"}\n\n',
          );
          res.end();
          return;
        }

        res.status(401).json({
          error: 'invalid_token',
          error_description: 'Invalid or expired access token',
        });
      }
    };
  }

  setupRoutes(app: express.Application): void {
    /**
     * OAuth 2.0 Authorization Server Metadata
     *
     * @remarks
     * MCP OAuth Step 3: Authorization Server Metadata
     *
     * Returns metadata about the authorization server including
     * available endpoints, supported flows, and capabilities.
     */
    app.get('/.well-known/oauth-authorization-server', (req, res) => {
      const origin = this.config.oauthIssuer;
      res.json({
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [],
        token_endpoint_auth_methods_supported: ['none'],
        subject_types_supported: ['public'],
      });
    });

    /**
     * OAuth 2.0 Protected Resource Metadata
     *
     * @remarks
     * MCP OAuth Step 2: Resource Metadata Discovery
     *
     * Returns metadata about the protected resource and its
     * authorization servers. Client discovers this URL from
     * WWW-Authenticate header in 401 response.
     */
    app.get('/.well-known/oauth-protected-resource', (req, res) => {
      res.json({
        resource: `${req.protocol}://${req.get('host')}`,
        authorization_servers: [`${req.protocol}://${req.get('host')}`],
        bearer_methods_supported: ['header'],
      });
    });

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

      // Validate redirect URIs if provided
      let validatedRedirectUris = []; //this.config.validRedirectUris;

      if (redirect_uris && Array.isArray(redirect_uris)) {
        validatedRedirectUris = [];
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

            // Allow HTTPS URLs
            if (url.protocol === 'https:') {
              validatedRedirectUris.push(uri);
            }
            // Allow HTTP only for localhost
            else if (
              url.protocol === 'http:' &&
              (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
            ) {
              validatedRedirectUris.push(uri);
            }
            // Allow custom schemes
            else if (url.protocol.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:$/)) {
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
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        application_type: 'native',
      });
    });

    /**
     * OAuth 2.1 Authorization Endpoint
     *
     * @remarks
     * MCP OAuth Step 5: Authorization Request with PKCE
     *
     * Handles authorization requests with PKCE parameters.
     * Validates request, stores pending authorization, and
     * redirects to OAuth for user consent.
     */
    app.get('/oauth/authorize', (req, res) => {
      const {
        client_id,
        redirect_uri,
        response_type,
        code_challenge,
        code_challenge_method,
        state,
        scope = 'read',
      } = req.query;

      // Validate parameters
      if (!client_id || !redirect_uri || !code_challenge) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters',
        });
        return;
      }

      if (response_type !== 'code') {
        res.status(400).json({
          error: 'unsupported_response_type',
          error_description: 'Only authorization code flow is supported',
        });
        return;
      }

      if (code_challenge_method !== 'S256') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Only S256 code challenge method is supported',
        });
        return;
      }

      // Validate redirect URI using security rules (for public clients)
      try {
        const url = new URL(redirect_uri as string);

        // Allow HTTPS URLs
        if (url.protocol === 'https:') {
          // HTTPS is always allowed
        }
        // Allow HTTP only for localhost
        else if (
          url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        ) {
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
          error_description:
            'Invalid redirect URI: must use HTTPS, localhost HTTP, or custom scheme',
        });
        return;
      }

      // Generate Tableau state and store pending authorization
      const tableauState = randomBytes(32).toString('hex');
      const authKey = randomBytes(32).toString('hex');

      this.pendingAuthorizations.set(authKey, {
        clientId: client_id as string,
        redirectUri: redirect_uri as string,
        codeChallenge: code_challenge as string,
        codeChallengeMethod: code_challenge_method as string,
        state: state as string,
        scope: scope as string,
        tableauState,
      });

      // Clean up expired authorizations
      setTimeout(
        () => this.pendingAuthorizations.delete(authKey),
        this.AUTHORIZATION_CODE_TIMEOUT_MS,
      );

      // Redirect to OAuth
      const codeChallenge = this.generateCodeChallenge(code_challenge as string);
      const oauthUrl = new URL(`${this.config.server}/oauth2/v1/auth`);
      oauthUrl.searchParams.set('client_id', '{B3838D73-E2A1-430C-A5AB-A52793B2B95A}');
      oauthUrl.searchParams.set('code_challenge', codeChallenge);
      oauthUrl.searchParams.set('code_challenge_method', code_challenge_method as string);
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('redirect_uri', this.config.redirectUri);
      oauthUrl.searchParams.set('state', `${authKey}:${tableauState}`);
      oauthUrl.searchParams.set('device_id', 'tableau-mcp');
      oauthUrl.searchParams.set('device_name', 'tableau-mcp');
      oauthUrl.searchParams.set('client_type', `tableau-mcp`);

      res.redirect(oauthUrl.toString());
    });

    /**
     * OAuth Callback Handler
     *
     * @remarks
     * MCP OAuth Step 6: OAuth Callback
     *
     * Receives callback from after user authorization.
     * Exchanges code for tokens, generates MCP authorization
     * code, and redirects back to client with code.
     */
    app.get('/Callback', async (req, res) => {
      const { code, state, error } = req.query;

      if (error) {
        res.status(400).json({
          error: 'access_denied',
          error_description: 'User denied authorization',
        });
        return;
      }

      if (!code || !state) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing code or state parameter',
        });
        return;
      }

      try {
        // Parse state to get auth key and Tableau state
        const [authKey, tableauState] = (state as string).split(':');
        const pendingAuth = this.pendingAuthorizations.get(authKey);

        if (!pendingAuth || pendingAuth.tableauState !== tableauState) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: `Invalid state parameter.`,
          });
          return;
        }

        const tokens = await this.exchangeAuthorizationCode(
          code as string,
          this.config.redirectUri,
          '{B3838D73-E2A1-430C-A5AB-A52793B2B95A}',
          pendingAuth.codeChallenge,
        );

        const restApi = new RestApi(this.config.server);
        restApi.setCredentials(tokens.access_token, tokens.user_id);
        const session = await restApi.serverMethods.getCurrentServerSession();
        const userId = session.user.id;

        // Generate authorization code
        const authorizationCode = randomBytes(32).toString('hex');
        this.authorizationCodes.set(authorizationCode, {
          clientId: pendingAuth.clientId,
          redirectUri: pendingAuth.redirectUri,
          codeChallenge: pendingAuth.codeChallenge,
          userId,
          tokens: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
          },
          expiresAt: Date.now() + this.AUTHORIZATION_CODE_TIMEOUT_MS,
        });

        // Clean up
        this.pendingAuthorizations.delete(authKey);

        // Redirect back to client with authorization code
        const redirectUrl = new URL(pendingAuth.redirectUri);
        redirectUrl.searchParams.set('code', authorizationCode);
        redirectUrl.searchParams.set('state', pendingAuth.state);

        res.redirect(redirectUrl.toString());
      } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({
          error: 'server_error',
          error_description: 'Internal server error during authorization',
        });
      }
    });

    /**
     * OAuth 2.1 Token Endpoint
     *
     * @remarks
     * MCP OAuth Step 7: Token Exchange with PKCE Verification
     *
     * Exchanges authorization code for access token.
     * Verifies PKCE code_verifier matches the original challenge.
     * Returns JWT containing tokens for API access.
     */
    app.post('/oauth/token', async (req, res) => {
      const { grant_type, code, redirect_uri, code_verifier, client_id } = req.body;

      try {
        if (grant_type === 'authorization_code') {
          // Handle authorization code exchange
          if (!code || !redirect_uri || !code_verifier || !client_id) {
            res.status(400).json({
              error: 'invalid_request',
              error_description: 'Missing required parameters',
            });
            return;
          }

          const authCode = this.authorizationCodes.get(code);
          if (!authCode || authCode.expiresAt < Date.now()) {
            this.authorizationCodes.delete(code);
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid or expired authorization code',
            });
            return;
          }

          // Verify PKCE
          const challengeFromVerifier = this.generateCodeChallenge(code_verifier);
          if (challengeFromVerifier !== authCode.codeChallenge) {
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'Invalid code verifier',
            });
            return;
          }

          // Generate tokens
          const refreshTokenId = randomBytes(32).toString('hex');
          const accessToken = await this.createAccessToken(authCode.userId, authCode.tokens);
          this.refreshTokens.set(refreshTokenId, {
            userId: authCode.userId,
            clientId: authCode.clientId,
            tokens: authCode.tokens,
            expiresAt: Date.now() + this.REFRESH_TOKEN_TIMEOUT_MS,
          });

          this.authorizationCodes.delete(code);

          res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: authCode.tokens.expiresIn,
            refresh_token: refreshTokenId,
            scope: 'read',
          });
          return;
        } else if (grant_type === 'refresh_token') {
          // // Handle refresh token
          // if (!refresh_token) {
          //   res.status(400).json({
          //     error: 'invalid_request',
          //     error_description: 'Missing refresh token',
          //   });
          //   return;
          // }

          // const tokenData = this.refreshTokens.get(refresh_token);
          // if (!tokenData || tokenData.expiresAt < Date.now()) {
          //   this.refreshTokens.delete(refresh_token);
          //   res.status(400).json({
          //     error: 'invalid_grant',
          //     error_description: 'Invalid or expired refresh token',
          //   });
          //   return;
          // }

          // // TODO: Refresh tokens if needed
          // const accessToken = await this.createAccessToken(tokenData.userId, tokenData.tokens);

          // res.json({
          //   access_token: accessToken,
          //   token_type: 'Bearer',
          //   expires_in: 86400, // 24 hours to match token expiry
          //   scope: 'read',
          // });
          return;
        } else {
          res.status(400).json({
            error: 'unsupported_grant_type',
            error_description:
              'Only authorization_code and refresh_token grant types are supported',
          });
          return;
        }
      } catch (error) {
        console.error('Token endpoint error:', error);
        res.status(500).json({
          error: 'server_error',
          error_description: 'Internal server error',
        });
        return;
      }
    });
  }

  /**
   * Verifies JWT access token and extracts credentials
   *
   * @remarks
   * MCP OAuth Step 8: Authenticated MCP Request
   *
   * Validates JWT signature and expiration.
   * Extracts access/refresh tokens for API calls.
   *
   * @param token - JWT access token from Authorization header
   * @returns AuthInfo with user details and tokens
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret, {
        audience: this.jwtAudience,
        issuer: this.jwtIssuer,
      });

      return {
        token,
        clientId: 'mcp-client',
        scopes: ['read'],
        expiresAt: payload.exp,
        extra: {
          userId: payload.sub,
          accessToken: payload.tableau_access_token,
          refreshToken: payload.tableau_refresh_token,
        },
      };
    } catch {
      // TODO: Auto-refresh logic would go here
      throw new Error('Invalid or expired access token');
    }
  }

  /**
   * Creates JWT access token containing credentials
   *
   * @remarks
   * Part of MCP OAuth Step 7: Token Exchange
   * JWT contains tokens for making API calls
   *
   * @param userId - username
   * @param tokens - access and refresh tokens
   * @returns Signed JWT token for MCP authentication
   */
  private async createAccessToken(userId: string, tokens: Tokens): Promise<string> {
    return await new SignJWT({
      sub: userId,
      tableau_access_token: tokens.accessToken,
      tableau_refresh_token: tokens.refreshToken,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Date.now() + tokens.expiresIn * 1000)
      .setAudience(this.jwtAudience)
      .setIssuer(this.jwtIssuer)
      .sign(this.jwtSecret);
  }

  /**
   * Generates PKCE code challenge from verifier
   *
   * @remarks
   * Part of MCP OAuth Step 5: Authorization Request with PKCE
   * Uses SHA256 hashing as required by S256 method
   *
   * @param verifier - Random code verifier string
   * @returns Base64url-encoded SHA256 hash of verifier
   */
  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /**
   * Exchanges authorization code for access tokens
   *
   * @remarks
   * Part of MCP OAuth Step 6: OAuth Callback
   * Uses token endpoint with basic auth
   *
   * @param code - Authorization code
   * @param redirectUri - Redirect URI used in initial request
   * @returns token response with access_token and refresh_token
   */
  private async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    clientId: string,
    codeVerifier: string,
  ): Promise<any> {
    const tokenUrl = `${this.config.server}/oauth2/v1/token`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to exchange authorization code: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }
}
