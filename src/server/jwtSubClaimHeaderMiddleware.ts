import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express, { RequestHandler } from 'express';

import { Config } from '../config.js';
import { writeToStdout } from '../logging/log.js';
import { AuthenticatedRequest } from './oauth/types.js';

function logJwtSubHeaderRequest(
  config: Config,
  req: express.Request,
  jwtSubClaimResolved: string,
): void {
  const forwardedFor = req.get('x-forwarded-for');
  const clientIp =
    (forwardedFor?.split(',')[0] ?? '').trim() || req.socket?.remoteAddress || req.ip;
  const line = JSON.stringify({
    type: 'jwt-sub-header-request',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path || req.url,
    headerName: config.jwtSubClaimRequestHeaderName,
    jwtSubClaimTemplate: config.jwtUsername,
    jwtSubClaimResolved,
    clientIp: clientIp || undefined,
    xForwardedFor: forwardedFor || undefined,
  });
  writeToStdout(`[tableau-mcp] ${line}`);
}

/**
 * When MCP OAuth is disabled, allows a trusted gateway to pass the Tableau JWT username per request.
 * Use with JWT_SUB_CLAIM={OAUTH_USERNAME} (and optional JWT_ADDITIONAL_PAYLOAD placeholders).
 */
export function jwtSubClaimHeaderMiddleware(config: Config): RequestHandler {
  const usernameHeader = config.jwtSubClaimRequestHeaderName;

  if (!usernameHeader) {
    return (_req, _res, next) => next();
  }

  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void => {
    if (config.oauth.enabled) {
      next();
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const rawUsername = authReq.get(usernameHeader);
    if (rawUsername === undefined) {
      next();
      return;
    }

    const username = rawUsername.trim();
    if (!username) {
      writeToStdout(
        `[tableau-mcp] ${JSON.stringify({
          type: 'jwt-sub-header-request-invalid',
          timestamp: new Date().toISOString(),
          method: req.method,
          path: req.path || req.url,
          headerName: usernameHeader,
          jwtSubClaimTemplate: config.jwtUsername,
          reason: 'empty_username_after_trim',
        })}`,
      );
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'JWT sub claim header must be a non-empty username.',
      });
      return;
    }

    logJwtSubHeaderRequest(config, req, username);

    const authInfo: AuthInfo = {
      token: '',
      clientId: 'jwt-sub-header',
      scopes: [],
      extra: { username },
    };
    authReq.auth = authInfo;
    next();
  };
}

export function jwtSubClaimHeaderCorsAllowList(config: Config): string[] {
  return config.jwtSubClaimRequestHeaderName ? [config.jwtSubClaimRequestHeaderName] : [];
}
