import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { ClientInfo, Server } from '../server.js';
import { createSession, getSession, Session } from '../sessions.js';
import { validateProtocolVersion } from './middleware.js';
import { OAuthProvider } from './oauth/provider.js';

export async function startExpressServer({
  basePath,
  config,
  logLevel,
}: {
  basePath: string;
  config: Config;
  logLevel: LoggingLevel;
}): Promise<{ url: string; app: express.Application; server: http.Server }> {
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

  const middleware: Array<RequestHandler> = [];
  if (config.oauth.enabled) {
    const oauthProvider = new OAuthProvider();
    oauthProvider.setupRoutes(app);
    middleware.push(oauthProvider.authMiddleware);
    middleware.push(validateProtocolVersion);
  }

  const path = `/${basePath}`;
  app.post(path, ...middleware, createMcpServer);
  app.get(path, ...middleware, handleSessionRequest);
  app.delete(path, ...middleware, handleSessionRequest);

  const useSsl = !!(config.sslKey && config.sslCert);
  if (!useSsl) {
    return new Promise((resolve) => {
      const server = http
        .createServer(app)
        .listen(config.httpPort, () =>
          resolve({ url: `http://localhost:${config.httpPort}/${basePath}`, app, server }),
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
    const server = https
      .createServer(options, app)
      .listen(config.httpPort, () =>
        resolve({ url: `https://localhost:${config.httpPort}/${basePath}`, app, server }),
      );
  });

  async function createMcpServer(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;
      let clientInfo: ClientInfo | undefined;

      let session: Session | undefined;
      if (sessionId && (session = getSession(sessionId))) {
        ({ transport, clientInfo } = session);
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

  let session: Session | undefined;
  if (!sessionId || !(session = getSession(sessionId))) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  await session.transport.handleRequest(req, res);
}
