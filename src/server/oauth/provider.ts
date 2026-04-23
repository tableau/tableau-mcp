import { createPrivateKey, createPublicKey, KeyObject } from 'crypto';
import express, { RequestHandler } from 'express';
import { readFileSync } from 'fs';

import { getConfig } from '../../config.js';
import { log } from '../../logging/logger.js';
import { oauthAuthorizationServer } from './.well-known/oauth-authorization-server.js';
import { oauthProtectedResource } from './.well-known/oauth-protected-resource.js';
import {
  AccessTokenValidator,
  EmbeddedAccessTokenValidator,
  TableauAccessTokenValidator,
} from './accessTokenValidator.js';
import { authMiddleware } from './authMiddleware.js';
import { authorize } from './authorize.js';
import { callback } from './callback.js';
import { register } from './register.js';
import { revoke } from './revoke.js';
import { token } from './token.js';
import { AuthorizationCode, PendingAuthorization, RefreshTokenData } from './types.js';

export const TABLEAU_CLOUD_SERVER_URL = 'https://online.tableau.com';

/**
 * Abstract OAuth provider
 *
 */
abstract class OAuthProvider {
  protected readonly config = getConfig();

  protected abstract get accessTokenValidator(): AccessTokenValidator;

  get authMiddleware(): RequestHandler {
    return authMiddleware(this.accessTokenValidator);
  }

  setupRoutes(app: express.Application): void {
    // .well-known/oauth-protected-resource
    oauthProtectedResource(app);
  }
}

/**
 * Embedded OAuth 2.1 Provider
 *
 * Implements the complete MCP OAuth 2.1 flow with PKCE
 * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 *
 */
export class EmbeddedOAuthProvider extends OAuthProvider {
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();
  private readonly authorizationCodes = new Map<string, AuthorizationCode>();
  private readonly refreshTokens = new Map<string, RefreshTokenData>();
  // Secondary index for O(1) revocation: Tableau access token -> MCP refresh token ID.
  // Expiry-timeout entries may become stale but are harmless and self-clean on next revoke.
  private readonly refreshTokenIndex = new Map<string, string>();

  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor() {
    super();

    this.privateKey = this.getPrivateKey();
    this.publicKey = createPublicKey(this.privateKey);
  }

  get accessTokenValidator(): AccessTokenValidator {
    return new EmbeddedAccessTokenValidator(this.privateKey);
  }

  setupRoutes(app: express.Application): void {
    // .well-known/oauth-protected-resource (from base)
    super.setupRoutes(app);

    // .well-known/oauth-authorization-server (embedded AS only)
    oauthAuthorizationServer(app);

    // oauth2/register
    register(app);

    // oauth2/authorize
    authorize(app, this.pendingAuthorizations);

    // /Callback
    callback(app, this.pendingAuthorizations, this.authorizationCodes);

    // oauth2/token
    token(app, this.authorizationCodes, this.refreshTokens, this.publicKey, this.refreshTokenIndex);

    // oauth2/revoke
    revoke(app, this.refreshTokens, this.privateKey, this.refreshTokenIndex);
  }

  private getPrivateKey(): KeyObject {
    let privateKeyContents = this.config.oauth.jwePrivateKey.replace(/\\n/g, '\n');
    if (!privateKeyContents) {
      try {
        privateKeyContents = readFileSync(this.config.oauth.jwePrivateKeyPath, 'utf8');
      } catch (error) {
        log({
          message: `Failed to read JWE private key file: ${error}`,
          level: 'error',
          logger: 'oauth',
        });
        throw new Error('Failed to read private key file');
      }
    }

    try {
      return createPrivateKey({
        key: privateKeyContents,
        format: 'pem',
        passphrase: this.config.oauth.jwePrivateKeyPassphrase,
      });
    } catch (error) {
      log({
        message: `Failed to create JWE private key: ${error}`,
        level: 'error',
        logger: 'oauth',
      });
      throw new Error('Failed to create private key');
    }
  }
}

/**
 * OAuth provider for the Tableau authorization server.
 *
 * In this mode the Tableau server IS the authorization server, so this MCP server
 * only acts as a resource server. The base setupRoutes() exposes the protected-resource
 * metadata document (so clients can discover the real AS) and nothing more — we must not
 * shadow the Tableau AS's own /.well-known/oauth-authorization-server.
 */
export class TableauOAuthProvider extends OAuthProvider {
  get accessTokenValidator(): AccessTokenValidator {
    return new TableauAccessTokenValidator();
  }
}
