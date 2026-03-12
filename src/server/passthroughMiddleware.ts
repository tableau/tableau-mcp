import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { getConfig, TEN_MINUTES_IN_MS } from '../config.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { ExpiringMap } from '../utils/expiringMap.js';
import { getSupportedMcpScopes } from './oauth/scopes.js';
import { AuthenticatedRequest } from './oauth/types.js';

export const X_TABLEAU_AUTH_HEADER = 'x-tableau-auth';

export const passthroughAuthInfoSchema = z.object({
  type: z.literal('Passthrough'),
  username: z.string(),
  userId: z.string(),
  server: z.string(),
  siteId: z.string(),
  raw: z.string(),
});

export type PassthroughAuthInfo = z.infer<typeof passthroughAuthInfoSchema>;

const passthroughAuthInfoCache = new ExpiringMap<string, PassthroughAuthInfo>({
  defaultExpirationTimeMs: TEN_MINUTES_IN_MS,
});

export function passthroughMiddleware(): RequestHandler {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const tableauAccessToken: string =
      getCookie(req, 'workgroup_session_id') || getHeader(req, X_TABLEAU_AUTH_HEADER);

    if (!tableauAccessToken) {
      next();
      return;
    }

    const config = getConfig();
    let passthroughAuthInfo = passthroughAuthInfoCache.get(tableauAccessToken);
    if (!passthroughAuthInfo) {
      const { server, maxRequestTimeoutMs } = config;

      const restApi = new RestApi(server, {
        maxRequestTimeoutMs,
      });

      restApi.setCredentials(tableauAccessToken, 'unknown user id');
      const sessionResult = await restApi.authenticatedServerMethods.getCurrentServerSession();
      if (!sessionResult.isOk()) {
        res.status(401).json({
          error: 'invalid_token',
          error_description: sessionResult.error,
        });
        return;
      }

      passthroughAuthInfo = {
        type: 'Passthrough',
        username: sessionResult.value.user.name,
        userId: sessionResult.value.user.id,
        server,
        siteId: sessionResult.value.site.id,
        raw: tableauAccessToken,
      };

      passthroughAuthInfoCache.set(tableauAccessToken, passthroughAuthInfo);
    }

    req.auth = {
      token: 'passthrough',
      clientId: 'passthrough',
      scopes: config.oauth.enforceScopes ? getSupportedMcpScopes() : [],
      extra: passthroughAuthInfo,
    };
    next();
  };
}

function getCookie(req: AuthenticatedRequest, cookieName: string): string {
  const cookieValue = req.cookies?.[cookieName];
  return cookieValue?.toString() ?? '';
}

function getHeader(req: AuthenticatedRequest, headerName: string): string {
  const headerValue = req.headers[headerName];
  return headerValue?.toString() ?? '';
}
