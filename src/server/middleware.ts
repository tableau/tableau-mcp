import { NextFunction, Request, Response } from 'express';

// Simple in-memory rate limiter
const requestCounts = new Map<string, { count: number; resetTime: number }>();

/**
 * Rate limiting middleware for MCP endpoints
 */
export function rateLimitMiddleware(
  windowMs: number = 60000, // 1 minute
  maxRequests: number = 100,
) {
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
      //logger.warn('Rate limit exceeded', { ip: key, count: rateData.count });
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
    //logger.warn('Unsupported protocol version', { version });
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
 * Request size limit middleware
 */
export function requestSizeLimit(maxSize: number = 10 * 1024 * 1024) {
  // 10MB default
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > maxSize) {
      //logger.warn('Request too large', { size: contentLength, maxSize });
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
