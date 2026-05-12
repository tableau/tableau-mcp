import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { KeyObject } from 'crypto';
import { compactDecrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import { getConfig } from '../../config.js';
import { log } from '../../logging/logger.js';
import { ExpiringMap } from '../../utils/expiringMap.js';
import { getSiteLuidFromAccessToken } from '../../utils/getSiteLuidFromAccessToken.js';
import { GoogleTokenInfoClient, TokenInfoResponse } from './googleTokenInfoClient.js';
import {
  mcpAccessTokenSchema,
  mcpAccessTokenUserOnlySchema,
  TableauAuthInfo,
  tableauBearerTokenSchema,
} from './schemas';
import { parseScopes } from './scopes.js';
import { AUDIENCE } from './token.js';

type AccessTokenValidatorResult = Result<AuthInfo, string>;

export abstract class AccessTokenValidator {
  protected readonly config = getConfig();

  abstract validate(token: string): Promise<AccessTokenValidatorResult>;
}

export class EmbeddedAccessTokenValidator extends AccessTokenValidator {
  private readonly privateKey: KeyObject;

  constructor(privateKey: KeyObject) {
    super();

    this.privateKey = privateKey;
  }

  async validate(token: string): Promise<AccessTokenValidatorResult> {
    try {
      const { plaintext } = await compactDecrypt(token, this.privateKey);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));

      const mcpAccessToken = mcpAccessTokenUserOnlySchema.safeParse(payload);
      if (!mcpAccessToken.success) {
        return Err(`Invalid access token: ${fromError(mcpAccessToken.error).toString()}`);
      }

      const { iss, aud, exp, clientId } = mcpAccessToken.data;
      if (
        iss !== this.config.oauth.issuer ||
        aud !== AUDIENCE ||
        exp < Math.floor(Date.now() / 1000)
      ) {
        // https://github.com/modelcontextprotocol/inspector/issues/608
        // MCP Inspector Not Using Refresh Token for Token Validation
        return new Err('Invalid or expired access token');
      }

      const tokenScopes = parseScopes(mcpAccessToken.data.scope);
      let tableauAuthInfo: TableauAuthInfo;
      if (this.config.auth === 'oauth') {
        const mcpAccessToken = mcpAccessTokenSchema.safeParse(payload);
        if (!mcpAccessToken.success) {
          return Err(`Invalid access token: ${fromError(mcpAccessToken.error).toString()}`);
        }

        const {
          tableauAccessToken,
          tableauRefreshToken,
          tableauExpiresAt,
          tableauUserId,
          tableauServer,
          sub,
        } = mcpAccessToken.data;

        if (tableauExpiresAt < Math.floor(Date.now() / 1000)) {
          return new Err('Invalid or expired access token');
        }

        tableauAuthInfo = {
          type: 'X-Tableau-Auth',
          username: sub,
          userId: tableauUserId,
          siteId: getSiteLuidFromAccessToken(tableauAccessToken),
          server: tableauServer,
          accessToken: tableauAccessToken,
          refreshToken: tableauRefreshToken,
        };
      } else {
        const { tableauUserId, tableauSiteId, tableauServer, sub } = mcpAccessToken.data;
        tableauAuthInfo = {
          type: 'X-Tableau-Auth',
          username: sub,
          server: tableauServer,
          ...(tableauUserId ? { userId: tableauUserId } : {}),
          ...(tableauSiteId ? { siteId: tableauSiteId } : {}),
        };
      }

      return Ok({
        token,
        clientId,
        scopes: tokenScopes,
        expiresAt: payload.exp,
        extra: tableauAuthInfo,
      });
    } catch (error) {
      log({
        message: 'Embedded access token validation error',
        level: 'debug',
        logger: 'oauth',
        error,
      });
      return new Err('Invalid or expired access token');
    }
  }
}

export class TableauAccessTokenValidator extends AccessTokenValidator {
  async validate(token: string): Promise<AccessTokenValidatorResult> {
    try {
      const [_header, payload, _signature] = token.split('.');
      if (!payload) {
        return new Err('Invalid or expired access token');
      }
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());

      const parsed = tableauBearerTokenSchema.safeParse(decoded);
      if (!parsed.success) {
        return Err(`Invalid access token: ${fromError(parsed.error).toString()}`);
      }

      const {
        sub,
        iss,
        aud,
        exp,
        scope,
        client_id,
        'https://tableau.com/siteId': siteId,
        'https://tableau.com/userId': userId,
        'https://tableau.com/targetUrl': targetUrl,
      } = parsed.data;

      if (iss !== this.config.oauth.issuer || exp < Math.floor(Date.now() / 1000)) {
        return new Err('Invalid or expired access token');
      }

      // Prefer the explicit client_id claim introduced in the new Tableau AS token contract.
      // Fall back to aud during the compatibility window when client_id is absent (legacy tokens).
      // TODO(cleanup): once George's AS rollout is complete and client_id is confirmed live in all
      // environments, remove the aud fallback and update the schema to require client_id.
      const oauthClientId = client_id ?? aud;

      const tableauAuthInfo: TableauAuthInfo = {
        type: 'Bearer',
        username: sub,
        server: targetUrl,
        siteId,
        userId,
        raw: token,
        clientId: oauthClientId,
      };

      return Ok({
        token,
        clientId: oauthClientId,
        scopes: parseScopes(scope),
        expiresAt: exp,
        extra: tableauAuthInfo,
      });
    } catch (error) {
      log({
        message: 'Tableau access token validation error',
        level: 'debug',
        logger: 'oauth',
        error,
      });
      return new Err('Invalid or expired access token');
    }
  }
}

export class GoogleOpaqueAccessTokenValidator extends AccessTokenValidator {
  private readonly client: GoogleTokenInfoClient;
  private readonly cache: ExpiringMap<string, AuthInfo>;
  private readonly maxCacheSize: number;

  constructor(client?: GoogleTokenInfoClient) {
    super();

    this.client = client ?? new GoogleTokenInfoClient({
      tokeninfoUrl: this.config.oidc.tokeninfoUrl,
    });

    this.cache = new ExpiringMap<string, AuthInfo>({
      defaultExpirationTimeMs: this.config.oidc.validationCacheTtlSeconds * 1000,
    });
    this.maxCacheSize = this.config.oidc.validationCacheMax;
  }

  async validate(token: string): Promise<AccessTokenValidatorResult> {
    const cached = this.cache.get(token);
    if (cached) {
      return Ok(cached);
    }

    let tokenInfo: TokenInfoResponse;
    try {
      tokenInfo = await this.client.validate(token);
    } catch (error) {
      log({
        message: 'Google token validation failed',
        level: 'debug',
        logger: 'oauth',
        error,
      });
      return new Err('Invalid or expired access token');
    }

    const { expectedAudiences, expectedHd } = this.config.oidc;

    if (!expectedAudiences.includes(tokenInfo.aud)) {
      log({
        message: `Google token aud mismatch: got ${tokenInfo.aud}, expected one of [${expectedAudiences.join(', ')}]`,
        level: 'info',
        logger: 'oauth',
      });
      return new Err('Token audience mismatch');
    }

    if (expectedHd && tokenInfo.hd !== expectedHd) {
      log({
        message: `Google token hd mismatch: got ${tokenInfo.hd ?? 'undefined'}, expected ${expectedHd}`,
        level: 'info',
        logger: 'oauth',
      });
      return new Err('hd mismatch');
    }

    const username = this.config.oidc.usernameMap[tokenInfo.email] ?? tokenInfo.email;

    const tableauAuthInfo: TableauAuthInfo = {
      type: 'X-Tableau-Auth',
      username,
      server: this.config.server,
    };

    const authInfo: AuthInfo = {
      token,
      clientId: tokenInfo.aud,
      scopes: tokenInfo.scope?.split(' ') ?? [],
      expiresAt: Math.floor(Date.now() / 1000) + tokenInfo.expires_in,
      extra: tableauAuthInfo,
    };

    const cacheTtlMs = Math.min(
      tokenInfo.expires_in * 1000,
      this.config.oidc.validationCacheTtlSeconds * 1000,
    );

    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest entry (first key in Map iteration order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(token, authInfo, cacheTtlMs);

    return Ok(authInfo);
  }
}
