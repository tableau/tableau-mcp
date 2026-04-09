import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { NextFunction, Request, Response } from 'express';

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
