import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { Server } from '../server.js';
import { rateLimitMiddleware, requestSizeLimit } from './middleware.js';

export async function startExpressServer({
  basePath,
  config,
  logLevel,
}: {
  basePath: string;
  config: Config;
  logLevel: LoggingLevel;
}): Promise<{ url: string }> {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded());

  app.use(
    cors({
      origin: config.corsOriginConfig,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Cache-Control',
        'Accept',
        'MCP-Protocol-Version',
      ],
      exposedHeaders: ['mcp-session-id', 'x-session-id'],
    }),
  );

  const middleware = [
    rateLimitMiddleware({ windowMs: 60000, maxRequestsInWindow: 100 }), // 100 requests per minute
    requestSizeLimit({ maxSize: 10 * 1024 * 1024 }), // 10MB max
  ];

  const path = `/${basePath}`;
  app.post(path, ...middleware, createMcpServer);
  app.get(path, ...middleware, methodNotAllowed);
  app.delete(path, ...middleware, methodNotAllowed);

  const useSsl = !!(config.sslKey && config.sslCert);
  if (!useSsl) {
    return new Promise((resolve) => {
      http
        .createServer(app)
        .listen(config.httpPort, () =>
          resolve({ url: `http://localhost:${config.httpPort}/${basePath}` }),
        );
    });
  }

  if (!existsSync(config.sslKey)) {
    throw new Error('SSL key file does not exist');
  }

  if (!existsSync(config.sslCert)) {
    throw new Error('SSL cert file does not exist');
  }

  const options = {
    key: fs.readFileSync(config.sslKey),
    cert: fs.readFileSync(config.sslCert),
  };

  return new Promise((resolve) => {
    https
      .createServer(options, app)
      .listen(config.httpPort, () =>
        resolve({ url: `https://localhost:${config.httpPort}/${basePath}` }),
      );
  });

  async function createMcpServer(req: Request, res: Response): Promise<void> {
    try {
      const server = new Server();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close();
        server.close();
      });

      server.registerTools();
      server.registerRequestHandlers();

      await server.connect(transport);
      setLogLevel(server, logLevel);

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  }
}

async function methodNotAllowed(_req: Request, res: Response): Promise<void> {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    }),
  );
}
