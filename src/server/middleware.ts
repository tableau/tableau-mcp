import { NextFunction, Request, Response } from 'express';

type RateLimitData = { count: number; resetTime: number };
const requestCounts = new Map<string, RateLimitData>();

/**
 * Rate limiting middleware for MCP endpoints
 */
export function rateLimitMiddleware({
  windowMs,
  maxRequestsInWindow,
}: {
  windowMs: number;
  maxRequestsInWindow: number;
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
    if (rateData.count >= maxRequestsInWindow) {
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

/**
 * Request size limit middleware
 */
export function requestSizeLimit({ maxSize }: { maxSize: number }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxSize) {
      res.status(413).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Request entity too large',
          data: { maxSize, received: contentLength },
        },
        id: null,
      });
      return;
    }

    next();
  };
}

/**
 * Clean up old rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(key);
    }
  }
}, 60000); // Clean up every minute
