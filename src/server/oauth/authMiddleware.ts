import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { NextFunction, RequestHandler, Response } from 'express';

import { getConfig } from '../../config.js';
import {
  isSiteSettingsScopeRequired,
  isStrictScopeMatchEnabled,
} from '../../features/strictScopeMatch.js';
import { log } from '../../logging/logger.js';
import { sanitizeClientIdForTelemetry } from '../../telemetry/clientDisplayName.js';
import { getProductTelemetry } from '../../telemetry/productTelemetry/telemetryForwarder.js';
import {
  OAUTH_AUTH_CHALLENGE_GUIDANCE,
  OAUTH_INSUFFICIENT_SCOPE_GUIDANCE,
} from '../../utils/authErrorMessage.js';
import { getToolNameFromRequestBody } from '../requestUtils.js';
import { AccessTokenValidator } from './accessTokenValidator.js';
import {
  formatScopes,
  getRequiredApiScopesForTool,
  getRequiredMcpScopesForTool,
  getSupportedApiScopes,
  getSupportedMcpScopes,
  MCP_SITE_SETTINGS_READ_SCOPE,
} from './scopes.js';
import { AuthenticatedRequest } from './types.js';

const protectedResourceMetadataPath = '/.well-known/oauth-protected-resource';

/**
 * Express middleware for OAuth authentication
 *
 * This middleware checks for Bearer token authorization.
 * If no token is present, returns 401 with WWW-Authenticate header
 * pointing to resource metadata endpoint.
 *
 * @returns Express middleware function
 */
export function authMiddleware(accessTokenValidator: AccessTokenValidator): RequestHandler {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.auth) {
      // Auth already defined by previous middleware
      next();
      return;
    }

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

      const { enforceScopes, advertiseApiScopes, resourceUri } = getConfig().oauth;
      const baseUrl = new URL(resourceUri).origin;
      const resourceMetadataUrl = `${baseUrl}${protectedResourceMetadataPath}`;
      // This pre-auth challenge advertises what a fresh client may request. The server still
      // supports the full scope set under subset mode (subset only governs what is accepted, not
      // what is offered), so advertise the full set here — pass strict=true unconditionally.
      const requiredMcpScopes = await getRequiredMcpScopesForRequest(req.body, true);
      const requiredApiScopes = await getRequiredApiScopesForRequest(
        req.body,
        advertiseApiScopes,
        true,
      );
      const scopeParam =
        enforceScopes && requiredMcpScopes.length > 0
          ? `, scope="${formatScopes([...requiredMcpScopes, ...requiredApiScopes])}"`
          : '';
      res
        .status(401)
        .header(
          'WWW-Authenticate',
          `Bearer realm="MCP", resource_metadata="${resourceMetadataUrl}"${scopeParam}`,
        )
        .json({
          error: 'unauthorized',
          // Keep the WWW-Authenticate challenge (above) intact so the re-auth flow still works, but
          // enrich the human-readable description with the shared multi-server guidance so a missing
          // or expired token is not misread as a missing feature (W-23757363).
          error_description: `Authorization required. Use the OAuth 2.1 flow to authenticate. ${OAUTH_AUTH_CHALLENGE_GUIDANCE}`,
        });
      return;
    }

    const token = authHeader.slice(7);
    const result = await accessTokenValidator.validate(token);

    if (result.isErr()) {
      // For SSE requests (GET), provide proper SSE error response
      if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
        res.writeHead(401, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('event: error\n');
        res.write(`data: {"error": "invalid_token", "error_description": "${result.error}"}\n\n`);
        res.end();
        return;
      }

      log({
        message: `Access token validation failed: ${result.error}`,
        level: 'error',
        logger: 'oauth',
        data: result.error,
      });
      res.status(401).json({
        error: 'invalid_token',
        // Same shared guidance for an invalid/expired token so it is not misread as a missing
        // feature (W-23757363). The underlying validation detail is preserved first.
        error_description: `${result.error}. ${OAUTH_AUTH_CHALLENGE_GUIDANCE}`,
      });
      return;
    }
    const authInfo = result.value;
    const config = getConfig();
    const { enforceScopes, advertiseApiScopes } = config.oauth;
    if (enforceScopes) {
      const strict = await isStrictScopeMatchEnabled(config);
      const requiredMcpScopes = await getRequiredMcpScopesForRequest(
        req.body,
        strict,
        authInfo.clientId,
      );
      const requiredApiScopes = await getRequiredApiScopesForRequest(
        req.body,
        advertiseApiScopes,
        strict,
        authInfo.clientId,
      );
      const missingMcpScopes = requiredMcpScopes.filter(
        (scope) => !authInfo.scopes.includes(scope),
      );
      const shouldCheckApiScopes = advertiseApiScopes;
      const missingApiScopes = shouldCheckApiScopes
        ? requiredApiScopes.filter((scope) => !authInfo.scopes.includes(scope))
        : [];
      // Checked on every request, including initialize: registration reads the site's settings for
      // every session, and a token without the scope would read them as empty.
      const missingMandatory =
        (await isSiteSettingsScopeRequired(config)) &&
        !authInfo.scopes.includes(MCP_SITE_SETTINGS_READ_SCOPE)
          ? [MCP_SITE_SETTINGS_READ_SCOPE]
          : [];
      const missingScopes = [...missingMcpScopes, ...missingApiScopes, ...missingMandatory];

      if (missingScopes.length > 0) {
        // A tools/call that is under-scoped is an error (the client asked to run a specific tool it
        // cannot); a startup request (initialize / tools/list) that comes in under-scoped is routine
        // under subset mode, so log it at info to avoid alarming operators on every connect.
        const toolName = isInitializeRequest(req.body)
          ? undefined
          : getToolNameFromRequestBody(req.body);
        const isToolCall = toolName !== undefined;
        log({
          message: isToolCall
            ? `Insufficient scopes for tool ${toolName}: missing [${missingScopes.join(', ')}]`
            : `Insufficient scopes: missing [${missingScopes.join(', ')}]`,
          level: isToolCall ? 'error' : 'info',
          logger: 'oauth',
        });
        try {
          getProductTelemetry().send('tableau_mcp_event', {
            event_type: 'oauth_scope_gap',
            oauth_client_id: sanitizeClientIdForTelemetry(authInfo.clientId),
            missing_scope_count: missingScopes.length,
            missing_scopes: missingScopes.join(' '),
            is_tool_call: isToolCall,
          });
        } catch {
          // Telemetry is best-effort; never let it affect the auth response.
        }
        const { resourceUri } = getConfig().oauth;
        const baseUrl = new URL(resourceUri).origin;
        const resourceMetadataUrl = `${baseUrl}${protectedResourceMetadataPath}`;
        // Dedupe so the mandatory scope is not listed twice when advertiseApiScopes is on and it is
        // already part of the advertised API set. The token's existing scopes are unioned in last so a
        // re-auth keeps what it already holds instead of narrowing to only the newly-required scopes.
        const requiredScopesForChallenge = [
          ...new Set([
            ...requiredMcpScopes,
            ...(shouldCheckApiScopes ? requiredApiScopes : []),
            ...missingMandatory,
            ...authInfo.scopes,
          ]),
        ];
        const scopeParam = `scope="${formatScopes(requiredScopesForChallenge)}"`;
        // Name the specific missing scopes and append the shared 403 guidance so the failure is not
        // misread as a missing feature. The challenge header keeps a static error_description (it is a
        // header value); the richer text goes in the response body.
        const errorDescription = `Missing required scopes: ${formatScopes(missingScopes)}. ${OAUTH_INSUFFICIENT_SCOPE_GUIDANCE}`;
        const wwwAuthenticate = `Bearer realm="MCP", error="insufficient_scope", error_description="Missing required scopes", resource_metadata="${resourceMetadataUrl}", ${scopeParam}`;

        if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(403, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'WWW-Authenticate': wwwAuthenticate,
          });
          res.write('event: error\n');
          // JSON.stringify so the interpolated scope list is escaped safely in the SSE data frame.
          res.write(
            `data: ${JSON.stringify({ error: 'insufficient_scope', error_description: errorDescription })}\n\n`,
          );
          res.end();
          return;
        }

        res.status(403).header('WWW-Authenticate', wwwAuthenticate).json({
          error: 'insufficient_scope',
          error_description: errorDescription,
        });
        return;
      }
    }

    req.auth = authInfo;
    next();
  };
}

async function getRequiredMcpScopesForRequest(
  body: unknown,
  strict: boolean,
  clientId?: string,
): Promise<string[]> {
  // A non-tool request (initialize, or any non-CallTool/batch body) demands the full supported MCP
  // set only under strict matching. Under subset mode it requires no MCP scopes here — the caller
  // may hold a subset, and the mandatory site-settings scope is enforced separately.
  const toolName = isInitializeRequest(body) ? undefined : getToolNameFromRequestBody(body);
  if (toolName === undefined) {
    return strict ? getSupportedMcpScopes(clientId) : [];
  }

  const scopes = new Set<string>();
  for (const scope of getRequiredMcpScopesForTool(toolName)) {
    scopes.add(scope);
  }

  return Array.from(scopes);
}

async function getRequiredApiScopesForRequest(
  body: unknown,
  includeApiScopes: boolean,
  strict: boolean,
  clientId?: string,
): Promise<string[]> {
  if (!includeApiScopes) {
    return [];
  }

  if (isInitializeRequest(body)) {
    // Under subset mode the initialize request demands no full API set (per-tool checks still apply
    // to tool requests); under strict it keeps requiring the non-optional supported API scopes.
    // Optional post-publish reads must not prevent clients from initializing or publishing.
    return strict ? getSupportedApiScopes(clientId, { includeOptionalScopes: false }) : [];
  }

  const toolName = getToolNameFromRequestBody(body);
  if (toolName === undefined) {
    return [];
  }

  const scopes = new Set<string>();
  for (const scope of getRequiredApiScopesForTool(toolName)) {
    scopes.add(scope);
  }

  return Array.from(scopes);
}
