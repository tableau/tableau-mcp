import { NextFunction, RequestHandler, Response } from 'express';

import { isRequestOverridableVariable } from '../overridableConfig';
import { AuthenticatedRequest } from './oauth/types';
import { getHeader } from './requestUtils';

export const X_TABLEAU_MCP_CONFIG_HEADER = 'x-tableau-mcp-config';

export function requestOverrideMiddleware(): RequestHandler {
  // TODO: check if request overriding is enabled on the config?
  // TODO: check change req from AuthenticatedRequest type
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const requestOverrideString: string = getHeader(req, X_TABLEAU_MCP_CONFIG_HEADER);
    if (!requestOverrideString) {
      next();
      return;
    }

    const requestOverrides: Record<string, string> = {};

    requestOverrideString.split('&').forEach((overrideString) => {
      const [key, value] = overrideString.split('=');
      if (isRequestOverridableVariable(key)) {
        if (value === undefined) {
          throw new Error(
            `'${X_TABLEAU_MCP_CONFIG_HEADER}' header does not provide a value for '${key}'`,
          );
        }
        requestOverrides[key] = value;
      } else {
        throw new Error(`'${X_TABLEAU_MCP_CONFIG_HEADER}' header is invalid`);
      }
    });

    req.overrides = requestOverrides;
    next();
  };
}
