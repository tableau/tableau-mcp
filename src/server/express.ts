import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { ClientInfo, Server } from '../server.js';
import { createSession, getSession, hasSession } from '../sessions.js';

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

  const path = `/${basePath}`;
  app.post(path, createMcpServer);
  app.get(path, handleSessionRequest);
  app.delete(path, handleSessionRequest);

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
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;
      let clientInfo: ClientInfo | undefined;

      if (sessionId && hasSession(sessionId)) {
        ({ transport, clientInfo } = getSession(sessionId));
      } else if (!sessionId && isInitializeRequest(req.body)) {
        clientInfo = req.body.params.clientInfo;
        transport = createSession({ clientInfo });

        const server = new Server({ clientInfo });

        server.registerTools();
        server.registerRequestHandlers();

        await server.connect(transport);
        setLogLevel(server, logLevel);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
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
}

async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !hasSession(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  await getSession(sessionId).transport.handleRequest(req, res);
}
