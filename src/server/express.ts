import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config, getConfig } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { Server } from '../server.js';
import { validateProtocolVersion } from './middleware.js';
import { OAuthProvider } from './oauth/provider.js';
import { getSessionFromRequest, Session } from './session.js';

const sessions: { [sessionId: string]: Session } = {};

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
        'mcp-session-id',
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
  app.get(path, ...middleware, methodNotAllowed);
  app.delete(
    path,
    ...middleware,
    config.toolRegistrationMode === 'service' ? handleSessionRequest : methodNotAllowed,
  );

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
    const { toolRegistrationMode } = getConfig();
    const stateful = toolRegistrationMode === 'service';
    try {
      const server = new Server();
      const getSessionResult = getSessionFromRequest({
        stateful,
        req,
        res,
      });

      if (!getSessionResult) {
        return;
      }

      const { session, fromCache } = getSessionResult;
      if (!session) {
        return;
      }

      if (!fromCache) {
        server.registerTools();
        server.registerRequestHandlers();

        if (!stateful) {
          res.on('close', () => {
            session.transport.close();
            server.close();
          });
        }

        await server.connect(session.transport);
        setLogLevel(server, logLevel);
      }

      await session.transport.handleRequest(req, res, req.body);
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

// Reusable handler for GET and DELETE requests
async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'];

  if (Array.isArray(sessionId)) {
    res.status(400).send('Bad Request: Multiple MCP-Session-Id headers are not supported');
    return;
  }

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).send('Bad Request: Invalid or missing MCP-Session-Id header');
    return;
  }

  const session = sessions[sessionId];
  await session.transport.handleRequest(req, res);
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
