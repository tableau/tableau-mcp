import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { NextFunction, Request, Response } from 'express';

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
  const supportedVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
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
 * Validate required headers for passthrough auth mode.
 * Returns 401 if Authorization or X-Tableau-User-Id headers are missing.
 */
export function validatePassthroughHeaders(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const userId = req.headers['x-tableau-user-id'];

  if (!authHeader || !userId) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message:
          'Unauthorized: Authorization and X-Tableau-User-Id headers are required for passthrough auth',
      },
      id: null,
    });
    return;
  }

  next();
}

// https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping
export function handlePingRequest(req: Request, res: Response, next: NextFunction): void {
  const pingRequest = PingRequestSchema.safeParse(req.body);
  if (pingRequest.success) {
    res.status(200).json({
      jsonrpc: '2.0',
      id: req.body.id,
      result: {},
    });
    return;
  }
  next();
}
