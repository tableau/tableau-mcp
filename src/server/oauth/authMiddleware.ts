import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { RequestHandler } from 'express';

import { getConfig } from '../../config.js';
import { getToolNamesFromRequestBody } from '../requestUtils.js';
import { AccessTokenValidator } from './accessTokenValidator.js';
import {
  formatScopes,
  getRequiredApiScopesForTool,
  getRequiredScopesForTool,
  getSupportedApiScopes,
  getSupportedMcpScopes,
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
export function authMiddleware(accessTokenValidator: AccessTokenValidator): RequestHandler {
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
