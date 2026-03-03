import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';

import { getConfig } from '../config';
import { RestApi } from '../sdks/tableau/restApi';
import { getSupportedMcpScopes } from './oauth/scopes';
import { AuthenticatedRequest } from './oauth/types';

export const X_TABLEAU_AUTH_HEADER = 'x-tableau-auth';
export const X_TABLEAU_USER_ID_HEADER = 'x-tableau-user-id';

export const passthroughAuthInfoSchema = z.object({
  type: z.literal('Passthrough'),
  username: z.string(),
  userId: z.string(),
  server: z.string(),
  siteId: z.string(),
  raw: z.string(),
});

export type PassthroughAuthInfo = z.infer<typeof passthroughAuthInfoSchema>;

export function passthroughMiddleware(): RequestHandler {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const tableauAccessToken: string =
      getCookie(req, 'workgroup_session_id') || getHeader(req, X_TABLEAU_AUTH_HEADER);

    if (!tableauAccessToken) {
      next();
      return;
    }

    const {
      server,
      maxRequestTimeoutMs,
      oauth: { enforceScopes },
    } = getConfig();

    const restApi = new RestApi(getConfig().server, {
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

    const passthroughAuthInfo: PassthroughAuthInfo = {
      type: 'Passthrough',
      username: sessionResult.value.user.name,
      userId: sessionResult.value.user.id,
      server,
      siteId: sessionResult.value.site.id,
      raw: tableauAccessToken,
    };

    req.auth = {
      token: 'passthrough',
      clientId: 'passthrough',
      scopes: enforceScopes ? getSupportedMcpScopes() : [],
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
