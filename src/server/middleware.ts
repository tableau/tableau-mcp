import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { NextFunction, Request, RequestHandler, Response } from 'express';

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

export function getRateLimitMiddleware({
  windowMs,
  maxRequests,
  responseFormat,
}: {
  windowMs: number;
  maxRequests: number;
  responseFormat: 'mcp' | 'html';
}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();

    let rateData = requestCounts.get(key);
    if (!rateData || now > rateData.resetTime) {
      rateData = { count: 0, resetTime: now + windowMs };
      requestCounts.set(key, rateData);
    }

    if (rateData.count >= maxRequests) {
      const retryAfter = Math.ceil((rateData.resetTime - now) / 1000);
      if (responseFormat === 'mcp') {
        res.status(429).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Too many requests',
            data: { retryAfter },
          },
        });
      } else {
        res.status(429).set('Retry-After', retryAfter.toString()).send(`
          <html lang="en-US">
            <head>
              <title>Too Many Requests</title>
            </head>
            <body>
              <h1>Too Many Requests</h1>
              <p>You're doing that too often! Try again in ${retryAfter} seconds.</p>
            </body>
          </html>
        `);
      }
      return;
    }

    rateData.count++;
    next();
  };
}
