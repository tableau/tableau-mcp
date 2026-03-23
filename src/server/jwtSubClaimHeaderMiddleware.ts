import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express, { RequestHandler } from 'express';

import { Config } from '../config.js';
import { AuthenticatedRequest } from './oauth/types.js';

export { DEFAULT_JWT_SUB_SECRET_HEADER } from '../utils/safeHttpHeaderName.js';

/**
 * When MCP OAuth is disabled, allows a trusted gateway to pass the Tableau JWT username per request.
 * Use with JWT_SUB_CLAIM={OAUTH_USERNAME} (and optional JWT_ADDITIONAL_PAYLOAD placeholders).
 */
export function jwtSubClaimHeaderMiddleware(config: Config): RequestHandler {
  const usernameHeader = config.jwtSubClaimRequestHeaderName;
  const secret = config.jwtSubClaimRequestSecret;
  const secretHeader = config.jwtSubClaimRequestSecretHeaderName;

  if (!usernameHeader || !secret) {
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

    const sentSecret = authReq.get(secretHeader);
    if (sentSecret !== secret) {
      res.status(401).json({
        error: 'unauthorized',
        error_description: 'Invalid or missing JWT sub claim header secret.',
      });
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
  const names: string[] = [];
  if (config.jwtSubClaimRequestHeaderName) {
    names.push(config.jwtSubClaimRequestHeaderName);
  }
  if (config.jwtSubClaimRequestSecretHeaderName) {
    names.push(config.jwtSubClaimRequestSecretHeaderName);
  }
  return names;
}
