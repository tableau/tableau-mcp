import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { KeyObject } from 'crypto';
import { compactDecrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import { getConfig } from '../../config.js';
import { log } from '../../logging/logger.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { getSiteLuidFromAccessToken } from '../../utils/getSiteLuidFromAccessToken.js';
import { buildResourceIdentifier } from './resourceIdentifier.js';
import {
  mcpAccessTokenSchema,
  mcpAccessTokenUserOnlySchema,
  TableauAuthInfo,
  tableauBearerTokenSchema,
} from './schemas';
import { parseScopes } from './scopes.js';
import { AUDIENCE } from './token.js';

type AccessTokenValidatorResult = Result<AuthInfo, string>;

// Cap attacker-controlled claim values before logging so an oversized claim cannot bloat log sinks.
const MAX_LOGGED_CLAIM_LENGTH = 256;
function truncateForLog(value: string): string {
  return value.length > MAX_LOGGED_CLAIM_LENGTH
    ? `${value.slice(0, MAX_LOGGED_CLAIM_LENGTH)}... (truncated)`
    : value;
}

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
        data: error,
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

      let { 'https://tableau.com/userId': userId } = parsed.data;
      const {
        sub,
        iss,
        aud,
        exp,
        scope,
        client_id,
        'https://tableau.com/siteId': siteId,
        'https://tableau.com/targetUrl': targetUrl,
      } = parsed.data;

      if (iss !== this.config.oauth.issuer || exp < Math.floor(Date.now() / 1000)) {
        return new Err('Invalid or expired access token');
      }

      // RFC 9068 audience validation: reject tokens not minted for this MCP server's resource
      // URL. Without this, a token issued for one deployment (same shared SSO issuer) passes
      // validation against another, surfacing later as an opaque 500. The pod-specific resource
      // identifier (OAUTH_RESOURCE_URI domain + /tableau-mcp path) is always accepted; the global
      // resource URL (when configured) is matched exactly as the AS stamps it.
      const allowedAudiences = [
        buildResourceIdentifier(this.config.oauth.resourceUri),
        ...(this.config.oauth.globalResourceUri ? [this.config.oauth.globalResourceUri] : []),
      ];
      if (!allowedAudiences.includes(aud)) {
        log({
          message: `Access token audience mismatch: expected one of [${allowedAudiences.join(', ')}], got '${truncateForLog(aud)}'`,
          level: 'debug',
          logger: 'oauth',
        });
        return new Err('Token audience does not match this MCP server');
      }

      // The Tableau AS token contract carries client_id as a distinct, always-present claim
      // (enforced by the schema). aud holds the resource URL and is never used as the client ID.
      const oauthClientId = client_id;

      const restApi = new RestApi({
        maxRequestTimeoutMs: this.config.maxRequestTimeoutMs,
      });

      restApi.setBearerToken(token);
      const sessionResult = await restApi.authenticatedServerMethods.getCurrentServerSession();
      if (sessionResult.isErr()) {
        log({
          message: 'Tableau access token validation error',
          level: 'debug',
          logger: 'oauth',
          data: sessionResult.error,
        });
        return new Err('Invalid or expired access token');
      }

      userId ??= sessionResult.value.user.id;
      const siteName = sessionResult.value.site.contentUrl || '';

      const tableauAuthInfo: TableauAuthInfo = {
        type: 'Bearer',
        username: sub,
        server: targetUrl,
        siteId,
        siteName,
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
        data: error,
      });
      return new Err('Invalid or expired access token');
    }
  }
}
