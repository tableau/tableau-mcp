import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express, { RequestHandler } from 'express';

import { Config } from '../config.js';
import { AuthenticatedRequest } from './oauth/types.js';

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
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'JWT sub claim header must be a non-empty username.',
      });
      return;
    }

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
