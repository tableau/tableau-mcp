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

const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function rateLimitMiddleware({
  windowMs,
  maxRequests,
}: {
  windowMs: number;
  maxRequests: number;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();

    // Get or create rate limit data
    let rateData = requestCounts.get(key);
    if (!rateData || now > rateData.resetTime) {
      rateData = { count: 0, resetTime: now + windowMs };
      requestCounts.set(key, rateData);
    }

    // Check rate limit
    if (rateData.count >= maxRequests) {
      res.status(429).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Too many requests',
          data: { retryAfter: Math.ceil((rateData.resetTime - now) / 1000) },
        },
        id: null,
      });
      return;
    }

    rateData.count++;
    next();
  };
}
