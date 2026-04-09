import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { getConfig } from '../config';
import { RestApi } from '../sdks/tableau/restApi';
import { ExpiringMap } from '../utils/expiringMap';
import { AuthenticatedRequest } from './oauth/types';

export const X_TABLEAU_AUTH_HEADER = 'x-tableau-auth';
const PASSTHROUGH_AUTH_CACHE_MAX_ENTRIES = 1000;

export const passthroughAuthInfoSchema = z.object({
  type: z.literal('Passthrough'),
  username: z.string(),
  userId: z.string(),
  server: z.string(),
  siteId: z.string(),
  raw: z.string(),
});

export type PassthroughAuthInfo = z.infer<typeof passthroughAuthInfoSchema>;

let passthroughAuthInfoCache: ExpiringMap<string, PassthroughAuthInfo> | undefined;

export function passthroughAuthMiddleware(): RequestHandler {
  const config = getConfig();

  if (!config.enablePassthroughAuth) {
    throw new Error('Passthrough auth is not enabled');
  }

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const tableauAccessToken: string =
      getHeader(req, X_TABLEAU_AUTH_HEADER) || getCookie(req, 'workgroup_session_id');

    if (!tableauAccessToken) {
      next();
      return;
    }

    const enableCaching = config.passthroughAuthUserSessionCheckIntervalInMinutes > 0;

    if (enableCaching && !passthroughAuthInfoCache) {
      passthroughAuthInfoCache = new ExpiringMap<string, PassthroughAuthInfo>({
        defaultExpirationTimeMs:
          config.passthroughAuthUserSessionCheckIntervalInMinutes * 60 * 1000,
      });
    }

    let passthroughAuthInfo = passthroughAuthInfoCache?.get(tableauAccessToken);
    if (!passthroughAuthInfo) {
      const { server, maxRequestTimeoutMs } = config;

      const restApi = new RestApi({
        maxRequestTimeoutMs,
      });

      restApi.setCredentials(tableauAccessToken, 'unknown user id');
      const sessionResult = await restApi.authenticatedServerMethods.getCurrentServerSession();
      if (!sessionResult.isOk()) {
        res.status(401).json({
          error: 'invalid_token',
          error_description: sessionResult.error.message,
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

      if (
        passthroughAuthInfoCache &&
        passthroughAuthInfoCache.size < PASSTHROUGH_AUTH_CACHE_MAX_ENTRIES
      ) {
        passthroughAuthInfoCache.set(tableauAccessToken, passthroughAuthInfo);
      }
    }

    req.auth = {
      token: 'passthrough',
      clientId: 'passthrough',
      // From TMCP, we have no way of verifying which scopes, if any, were used to obtain the access token.
      // We will rely on the downstream REST APIs to enforce scopes at the API level.
      // MCP scopes will not be enforced for passthrough auth.
      scopes: [],
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
