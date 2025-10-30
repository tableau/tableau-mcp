import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { KeyObject } from 'crypto';
import express, { RequestHandler } from 'express';
import { compactDecrypt } from 'jose';
import { Err, Ok, Result } from 'ts-results-es';
import { fromError } from 'zod-validation-error';

import { getConfig } from '../../config.js';
import { AUDIENCE } from './provider.js';
import { mcpAccessTokenSchema, mcpAccessTokenUserOnlySchema, TableauAuthInfo } from './schemas.js';
import { AuthenticatedRequest } from './types.js';

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
    req.auth = result.value;
    next();
  };
}

/**
 * Verifies JWE access token and extracts credentials
 *
 * @remarks
 * MCP OAuth Step 8: Authenticated MCP Request
 *
 * Decrypts and validates JWE signature and expiration.
 * Extracts access/refresh tokens for API calls.
 *
 * @param token - JWT access token from Authorization header
 * @returns AuthInfo with user details and tokens
 */
async function verifyAccessToken(
  token: string,
  jwePrivateKey: KeyObject,
): Promise<Result<AuthInfo, string>> {
  const config = getConfig();
  const privateKey = jwePrivateKey;
  try {
    const { plaintext } = await compactDecrypt(token, privateKey);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));

    if (
      !payload ||
      payload.iss !== config.oauth.issuer ||
      payload.aud !== AUDIENCE ||
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      // https://github.com/modelcontextprotocol/inspector/issues/608
      // MCP Inspector Not Using Refresh Token for Token Validation
      return new Err('Invalid or expired access token');
    }

    let authInfo: TableauAuthInfo;
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

      if (Date.now() > tableauExpiresAt) {
        return new Err('Invalid or expired access token');
      }

      authInfo = {
        username: sub,
        userId: tableauUserId,
        server: tableauServer,
        accessToken: tableauAccessToken,
        refreshToken: tableauRefreshToken,
      };
    } else {
      const mcpAccessToken = mcpAccessTokenUserOnlySchema.safeParse(payload);
      if (!mcpAccessToken.success) {
        return Err(`Invalid access token: ${fromError(mcpAccessToken.error).toString()}`);
      }

      const { tableauUserId, tableauServer, sub } = mcpAccessToken.data;
      authInfo = {
        username: sub,
        server: tableauServer,
        ...(tableauUserId ? { userId: tableauUserId } : {}),
      };
    }

    return Ok({
      token,
      // TODO: Include the client ID in the access token
      clientId: 'mcp-client',
      // TODO: Implement scopes
      scopes: ['read'],
      expiresAt: payload.exp,
      extra: authInfo,
    });
  } catch {
    return new Err('Invalid or expired access token');
  }
}
