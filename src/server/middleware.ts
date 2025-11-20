import { NextFunction, Request, Response } from 'express';

import { getConfig } from '../config.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { AuthenticatedRequest } from './oauth/types.js';

/**
 * Validate MCP protocol version
 */
export function validateProtocolVersion(req: Request, res: Response, next: NextFunction): void {
  const version = req.headers['mcp-protocol-version'];

  // If no version header, continue (backwards compatibility)
  if (!version) {
    next();
    return;
  }

  // Check supported versions
  const supportedVersions = ['2025-06-18', '2025-03-26', '2024-11-05'];
  if (!supportedVersions.includes(version as string)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Unsupported protocol version',
        data: { supported: supportedVersions, requested: version },
      },
      id: null,
    });
    return;
  }

  next();
}

/**
 * Read Tableau session cookie from request
 */
export async function validateTableauSessionCookie(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const workgroupSessionId = req.cookies.workgroup_session_id;
  if (workgroupSessionId && Array.isArray(workgroupSessionId)) {
    res.status(400).json({
      error: 'Bad Request',
      error_description: 'Workgroup session ID must be a string',
    });
    return;
  }

  if (!workgroupSessionId) {
    next();
    return;
  }

  const server = getConfig().server;
  const restApi = new RestApi(server);
  restApi.setCredentials(workgroupSessionId, 'unknown user id');
  const sessionResult = await restApi.serverMethods.getCurrentServerSession();

  if (sessionResult.isOk()) {
    req.auth = {
      token: '',
      clientId: '',
      scopes: [],
      extra: {
        server,
        accessToken: workgroupSessionId,
        userId: sessionResult.value.user.id,
        username: sessionResult.value.user.name,
      },
    };
  } else {
    res.status(401).json({
      error: 'Unauthorized',
      error_description: 'Invalid workgroup session ID',
    });
    return;
  }

  next();
}
