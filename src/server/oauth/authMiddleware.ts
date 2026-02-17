import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { KeyObject } from 'crypto';
import express, { RequestHandler } from 'express';
import { compactDecrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error';

import { getConfig } from '../../config.js';
import { isToolName, ToolName } from '../../tools/toolName.js';
import { AUDIENCE } from './provider.js';
import {
  mcpAccessTokenSchema,
  mcpAccessTokenUserOnlySchema,
  tableauAccessTokenSchema,
  TableauAuthInfo,
} from './schemas.js';
import {
  formatScopes,
  getRequiredApiScopesForTool,
  getRequiredScopesForTool,
  getSupportedApiScopes,
  getSupportedMcpScopes,
  parseScopes,
} from './scopes.js';
import { AuthenticatedRequest } from './types.js';

/**
 * Express middleware for OAuth authentication
 *
 * This middleware checks for Bearer token authorization.
 * If no token is present, returns 401 with WWW-Authenticate header
 * pointing to resource metadata endpoint.
 *
 * @returns Express middleware function
 */
export function authMiddleware(privateKey: KeyObject): RequestHandler {
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

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const { enforceScopes, advertiseApiScopes } = getConfig().oauth;
      const requiredMcpScopes = getRequiredMcpScopesForRequest(req.body);
      const requiredApiScopes = getRequiredApiScopesForRequest(req.body, advertiseApiScopes);
      const scopeParam =
        enforceScopes && requiredMcpScopes.length > 0
          ? `, scope="${formatScopes([...requiredMcpScopes, ...requiredApiScopes])}"`
          : '';
      res
        .status(401)
        .header(
          'WWW-Authenticate',
          `Bearer realm="MCP", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"${scopeParam}`,
        )
        .json({
          error: 'unauthorized',
          error_description: 'Authorization required. Use OAuth 2.1 flow.',
        });
      return;
    }

    const token = authHeader.slice(7);
    const result = await verifyAccessToken(token, privateKey);

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

      res.status(401).json({
        error: 'invalid_token',
        error_description: result.error,
      });
      return;
    }
    const authInfo = result.value;
    const { enforceScopes, advertiseApiScopes } = getConfig().oauth;
    if (enforceScopes) {
      const requiredMcpScopes = getRequiredMcpScopesForRequest(req.body);
      const requiredApiScopes = getRequiredApiScopesForRequest(req.body, advertiseApiScopes);
      const missingMcpScopes = requiredMcpScopes.filter(
        (scope) => !authInfo.scopes.includes(scope),
      );
      const shouldCheckApiScopes = advertiseApiScopes;
      const missingApiScopes = shouldCheckApiScopes
        ? requiredApiScopes.filter((scope) => !authInfo.scopes.includes(scope))
        : [];
      const missingScopes = [...missingMcpScopes, ...missingApiScopes];

      if (missingScopes.length > 0) {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const requiredScopesForChallenge = [
          ...requiredMcpScopes,
          ...(shouldCheckApiScopes ? requiredApiScopes : []),
        ];
        const scopeParam = `scope="${formatScopes(requiredScopesForChallenge)}"`;
        const wwwAuthenticate = `Bearer realm="MCP", error="insufficient_scope", error_description="Missing required scopes", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", ${scopeParam}`;

        if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(403, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'WWW-Authenticate': wwwAuthenticate,
          });
          res.write('event: error\n');
          res.write(
            'data: {"error": "insufficient_scope", "error_description": "Missing required scopes"}\n\n',
          );
          res.end();
          return;
        }

        res.status(403).header('WWW-Authenticate', wwwAuthenticate).json({
          error: 'insufficient_scope',
          error_description: 'Missing required scopes',
        });
        return;
      }
    }

    req.auth = authInfo;
    next();
  };
}

function getRequiredMcpScopesForRequest(body: unknown): string[] {
  if (isInitializeRequest(body)) {
    return getSupportedMcpScopes();
  }

  const toolNames = getToolNamesFromRequestBody(body);
  if (toolNames.length === 0) {
    return getSupportedMcpScopes();
  }

  const scopes = new Set<string>();
  for (const toolName of toolNames) {
    for (const scope of getRequiredScopesForTool(toolName)) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes);
}

function getRequiredApiScopesForRequest(body: unknown, includeApiScopes: boolean): string[] {
  if (!includeApiScopes) {
    return [];
  }

  if (isInitializeRequest(body)) {
    return getSupportedApiScopes();
  }

  const toolNames = getToolNamesFromRequestBody(body);
  if (toolNames.length === 0) {
    return [];
  }

  const scopes = new Set<string>();
  for (const toolName of toolNames) {
    for (const scope of getRequiredApiScopesForTool(toolName)) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes);
}

function getToolNamesFromRequestBody(body: unknown): ToolName[] {
  const requests = Array.isArray(body) ? body : [body];
  const toolNames = new Set<ToolName>();

  for (const request of requests) {
    if (!request || typeof request !== 'object') {
      continue;
    }
    const maybeRequest = request as {
      method?: unknown;
      params?: { name?: unknown };
    };
    if (maybeRequest.method !== 'tools/call') {
      continue;
    }
    const name = maybeRequest.params?.name;
    if (typeof name === 'string' && isToolName(name)) {
      toolNames.add(name);
    }
  }

  return Array.from(toolNames);
}

/**
 * Verifies JWE access token and extracts credentials
 *
 * Decrypts and validates JWE signature and expiration.
 * Extracts access/refresh tokens for API calls.
 *
 * @param token - JWT access token from Authorization header
 * @param jwePrivateKey - Private key for decrypting the token
 *
 * @returns AuthInfo with user details and tokens
 */
async function verifyAccessToken(
  token: string,
  jwePrivateKey: KeyObject,
): Promise<Result<AuthInfo, string>> {
  const config = getConfig();

  if (config.oauth.issuer === 'https://sso.online.dev.tabint.net') {
    const [_header, payload, _signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());

    const tableauAccessToken = tableauAccessTokenSchema.safeParse(decoded);
    if (!tableauAccessToken.success) {
      return Err(`Invalid access token: ${fromError(tableauAccessToken.error).toString()}`);
    }

    const {
      sub,
      iss,
      exp,
      scope,
      'https://tableau.com/siteId': siteId,
      'https://tableau.com/targetUrl': targetUrl,
    } = tableauAccessToken.data;

    if (iss !== config.oauth.issuer || exp < Math.floor(Date.now() / 1000)) {
      return new Err('Invalid or expired access token');
    }

    const tableauAuthInfo: TableauAuthInfo = {
      type: 'tableau',
      username: sub,
      server: targetUrl,
      siteId,
      raw: token,
    };

    return Ok({
      token,
      clientId: iss,
      scopes: parseScopes(scope),
      expiresAt: exp,
      extra: tableauAuthInfo,
    });
  }

  try {
    const { plaintext } = await compactDecrypt(token, jwePrivateKey);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));

    const mcpAccessToken = mcpAccessTokenUserOnlySchema.safeParse(payload);
    if (!mcpAccessToken.success) {
      return Err(`Invalid access token: ${fromError(mcpAccessToken.error).toString()}`);
    }

    const { iss, aud, exp, clientId } = mcpAccessToken.data;
    if (iss !== config.oauth.issuer || aud !== AUDIENCE || exp < Math.floor(Date.now() / 1000)) {
      // https://github.com/modelcontextprotocol/inspector/issues/608
      // MCP Inspector Not Using Refresh Token for Token Validation
      return new Err('Invalid or expired access token');
    }

    const tokenScopes = parseScopes(mcpAccessToken.data.scope);
    let tableauAuthInfo: TableauAuthInfo;
    if (config.auth === 'oauth') {
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
        type: 'local',
        username: sub,
        userId: tableauUserId,
        server: tableauServer,
        accessToken: tableauAccessToken,
        refreshToken: tableauRefreshToken,
      };
    } else {
      const { tableauUserId, tableauServer, sub } = mcpAccessToken.data;
      tableauAuthInfo = {
        type: 'local',
        username: sub,
        server: tableauServer,
        ...(tableauUserId ? { userId: tableauUserId } : {}),
      };
    }

    return Ok({
      token,
      clientId,
      scopes: tokenScopes,
      expiresAt: payload.exp,
      extra: tableauAuthInfo,
    });
  } catch {
    return new Err('Invalid or expired access token');
  }
}
