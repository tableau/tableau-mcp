import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { KeyObject } from 'crypto';
import { compactDecrypt, createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import { Config, getConfig } from '../../config.js';
import { AUDIT_LOGGER, log } from '../../logging/logger.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { getSiteLuidFromAccessToken } from '../../utils/getSiteLuidFromAccessToken.js';
import invariant from '../../utils/invariant.js';
import {
  buildResourceIdentifier,
  canonicalizeLoopbackHost,
  stripTrailingSlash,
} from './resourceIdentifier.js';
import {
  ExternalTokenClaims,
  externalTokenClaimsSchema,
  introspectionResponseSchema,
  mcpAccessTokenSchema,
  mcpAccessTokenUserOnlySchema,
  TableauAuthInfo,
  tableauBearerTokenSchema,
} from './schemas';
import { parseScopes } from './scopes.js';
import { checkEmbeddedTokenBinding } from './siteBinding.js';
import { AUDIENCE } from './token.js';

type AccessTokenValidatorResult = Result<AuthInfo, string>;

// Cap attacker-controlled claim values before logging so an oversized claim cannot bloat log sinks.
const MAX_LOGGED_CLAIM_LENGTH = 256;
function truncateForLog(value: string): string {
  return value.length > MAX_LOGGED_CLAIM_LENGTH
    ? `${value.slice(0, MAX_LOGGED_CLAIM_LENGTH)}... (truncated)`
    : value;
}

// The pod-specific resource identifier (OAUTH_RESOURCE_URI domain + /tableau-mcp path) is always
// accepted; each global resource URL (when configured) is matched as the AS stamps it. Both the
// allowed values and the token's aud are compared with trailing slashes stripped so a cosmetic `/`
// difference (RFC 3986 treats `https://host` and `https://host/` as the same resource) is not a
// mismatch, and with loopback hosts canonicalized so the interchangeable local-dev forms
// `localhost`, `127.0.0.1`, and `[::1]` (the resource URI defaults to `http://127.0.0.1:<port>`)
// are not a mismatch either. Both normalizations only collapse equivalent forms; remote hosts are
// exact.
export function matchAudience({
  aud,
  config,
}: {
  aud: string | string[];
  config: Pick<Config, 'oauth'>;
}): { allowedAudiences: string[]; matches: boolean } {
  const normalizeAudience = (uri: string): string =>
    stripTrailingSlash(canonicalizeLoopbackHost(uri));
  const allowedAudiences = [
    buildResourceIdentifier(config.oauth.resourceUri),
    ...config.oauth.globalResourceUris,
  ].map(normalizeAudience);
  const audiences = Array.isArray(aud) ? aud : [aud];
  return {
    allowedAudiences,
    matches: audiences.some((value) => allowedAudiences.includes(normalizeAudience(value))),
  };
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

        const restApi = new RestApi({
          maxRequestTimeoutMs: this.config.maxRequestTimeoutMs,
        });

        restApi.setCredentials(tableauAccessToken, tableauUserId);
        const sessionResult = await restApi.authenticatedServerMethods.getCurrentServerSession();
        if (sessionResult.isErr()) {
          log({
            message: 'Embedded access token validation error',
            level: 'error',
            logger: 'oauth',
            data: sessionResult.error,
          });
          return new Err('Invalid or expired access token');
        }

        const siteName = sessionResult.value.site.contentUrl || '';

        const bindingError = checkEmbeddedTokenBinding(
          this.config,
          { tableauServer, tableauSiteContentUrl: siteName },
          { name: sessionResult.value.site.name, contentUrl: siteName },
        );
        if (bindingError) {
          log({
            message: `Embedded access token rejected: ${bindingError}`,
            level: 'error',
            logger: 'oauth',
          });
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
          siteName,
        };
      } else {
        const { tableauUserId, tableauSiteId, tableauSiteContentUrl, tableauServer, sub } =
          mcpAccessToken.data;

        const bindingError = checkEmbeddedTokenBinding(this.config, {
          tableauServer,
          tableauSiteContentUrl,
        });
        if (bindingError) {
          log({
            message: `Embedded access token rejected: ${bindingError}`,
            level: 'error',
            logger: 'oauth',
          });
          return new Err('Invalid or expired access token');
        }

        tableauAuthInfo = {
          type: 'X-Tableau-Auth',
          username: sub,
          server: tableauServer,
          siteName: this.config.siteName,
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
        level: 'error',
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
      // validation against another, surfacing later as an opaque 500.
      const { allowedAudiences, matches } = matchAudience({ aud, config: this.config });
      if (!matches) {
        log({
          message: `Access token audience mismatch: expected one of [${allowedAudiences.join(', ')}], got '${truncateForLog(aud)}'`,
          level: 'error',
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
          level: 'error',
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
        level: 'error',
        logger: 'oauth',
        data: error,
      });
      return new Err('Invalid or expired access token');
    }
  }
}

const INTROSPECTION_TIMEOUT_MS = 5000;

// Asymmetric only, so an HS* token never verifies even if a key resolver yields a shared secret.
const EXTERNAL_JWT_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'Ed25519',
];
const EXTERNAL_JWT_CLOCK_TOLERANCE_SECONDS = 5;

function usernameFromClaim(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() && !/\p{Cc}/u.test(value) ? value : undefined;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : undefined;
}

/**
 * Validates tokens from an external OAuth/OIDC authorization server: JWT access tokens (RFC 9068)
 * or OpenID Connect ID tokens against its JWKS, or opaque tokens through token introspection
 * (RFC 7662). The configured claim becomes the Tableau username; outbound Tableau auth stays
 * direct-trust or UAT.
 */
export class ExternalAccessTokenValidator extends AccessTokenValidator {
  private readonly external: NonNullable<Config['oauth']['external']>;
  private readonly fetch: typeof fetch;
  private readonly getKey: JWTVerifyGetKey | undefined;

  constructor({
    fetch = globalThis.fetch,
    getKey,
  }: { fetch?: typeof globalThis.fetch; getKey?: JWTVerifyGetKey } = {}) {
    super();

    invariant(this.config.oauth.external, 'OAUTH_EXTERNAL_* environment variables are not set');
    this.external = this.config.oauth.external;
    this.fetch = fetch;
    this.getKey =
      getKey ??
      (this.external.jwksUri ? createRemoteJWKSet(new URL(this.external.jwksUri)) : undefined);
  }

  async validate(token: string): Promise<AccessTokenValidatorResult> {
    try {
      const claims = this.getKey
        ? await this.verifyJwt(token, this.getKey)
        : await this.introspect(token);
      if (claims.isErr()) {
        return this.reject(claims.error);
      }

      return this.toAuthInfo(token, claims.value);
    } catch (error) {
      return this.reject(error instanceof Error ? error.message : 'unknown error');
    }
  }

  private async verifyJwt(
    token: string,
    getKey: JWTVerifyGetKey,
  ): Promise<Result<ExternalTokenClaims, string>> {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: this.config.oauth.issuer,
      algorithms: EXTERNAL_JWT_ALGORITHMS,
      clockTolerance: EXTERNAL_JWT_CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
    });

    const claims = externalTokenClaimsSchema.safeParse(payload);
    return claims.success
      ? Ok(claims.data)
      : Err(`invalid claims: ${fromError(claims.error).toString()}`);
  }

  private async introspect(token: string): Promise<Result<ExternalTokenClaims, string>> {
    const { introspectionUri, introspectionClientId, introspectionClientSecret } = this.external;
    // RFC 6749 section 2.3.1: form-encode the client credentials before base64.
    const credentials = Buffer.from(
      `${encodeURIComponent(introspectionClientId)}:${encodeURIComponent(introspectionClientSecret)}`,
    ).toString('base64');

    const response = await this.fetch(introspectionUri, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
      redirect: 'error',
      signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
    });
    if (!response.ok) {
      return Err(`introspection endpoint returned HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // JSON.parse errors quote the start of the body, which may echo the token.
      return Err('introspection response is not valid JSON');
    }

    const parsed = introspectionResponseSchema.safeParse(body);
    if (!parsed.success) {
      return Err(`invalid introspection response: ${fromError(parsed.error).toString()}`);
    }

    const { active, tokenType, ...claims } = parsed.data;
    if (!active) {
      return Err('token is not active');
    }

    if (tokenType && /refresh/i.test(tokenType)) {
      return Err('token_type is a refresh token');
    }

    if (claims.iss !== undefined && claims.iss !== this.config.oauth.issuer) {
      return Err('unexpected iss');
    }

    if (claims.exp !== undefined && claims.exp < Math.floor(Date.now() / 1000)) {
      return Err('token is expired');
    }

    return Ok(claims);
  }

  private toAuthInfo(token: string, claims: ExternalTokenClaims): AccessTokenValidatorResult {
    const { aud = [], azp, clientId, exp, scope, scp } = claims;
    const { allowedAudiences, matches } = matchAudience({ aud, config: this.config });
    if (!matches) {
      return this.reject(
        `audience mismatch: expected one of [${allowedAudiences.join(', ')}], got '${truncateForLog([aud].flat().join(', '))}'`,
      );
    }

    const { usernameClaimName } = this.external;
    const claimsByName: Record<string, unknown> = claims;
    const username = usernameFromClaim(claimsByName[usernameClaimName]);
    if (username === undefined) {
      return this.reject(`missing or invalid '${truncateForLog(usernameClaimName)}' claim`);
    }

    const tableauAuthInfo: TableauAuthInfo = {
      type: 'X-Tableau-Auth',
      username,
      server: this.config.server,
      siteName: this.config.siteName,
    };

    return Ok({
      token,
      clientId: clientId ?? azp ?? '',
      scopes: parseScopes(scope ?? (Array.isArray(scp) ? scp.join(' ') : scp)),
      expiresAt: exp,
      extra: tableauAuthInfo,
    });
  }

  private reject(reason: string): AccessTokenValidatorResult {
    log({
      message: 'external-token-rejected',
      level: 'warning',
      logger: AUDIT_LOGGER,
      data: { reason },
    });
    return new Err('Invalid or expired access token');
  }
}
