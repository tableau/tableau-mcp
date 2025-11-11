import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';
import { v7 as uuidv7 } from 'uuid';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { Server } from '../server.js';

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
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  const server = new Server();
  server.registerTools();
  server.registerRequestHandlers();

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

  const path = `/${basePath}`;
  app.post(path, createMcpServer);
  app.get(path, config.stateful ? handleSessionRequest : methodNotAllowed);
  app.delete(path, config.stateful ? handleSessionRequest : methodNotAllowed);

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

  function getStreamableHttp(sessionId?: string, body?: any): StreamableHTTPServerTransport {
    if (config.stateful) {
      if (sessionId && transports[sessionId]) {
        return transports[sessionId];
      }

      if (!sessionId && isInitializeRequest(body)) {
        const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => uuidv7(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = newTransport;
          },
        });

        newTransport.onclose = () => {
          if (newTransport.sessionId) {
            delete transports[newTransport.sessionId];
          }
        };

        return newTransport;
      }
    }

    return new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
  }

  async function createMcpServer(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      const transport: StreamableHTTPServerTransport = getStreamableHttp(sessionId, req.body);
      if (!config.stateful) {
        res.on('close', () => {
          transport.close();
        });
      }
      if (sessionId && transports[sessionId]) {
        await transport.handleRequest(req, res, req.body);
      } else {
        await server.connect(transport);
        setLogLevel(server, logLevel);
        await transport.handleRequest(req, res, req.body);
      }
    } catch (error) {
      // eslint-disable-next-line no-console -- console.error is intentional here since the transport is not stdio.
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

  async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
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
