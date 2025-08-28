import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config, getConfig } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { Server } from '../server.js';
import { getJwt } from '../utils/getJwt.js';
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
  app.delete(path, ...middleware, methodNotAllowed);
  app.post('/jwt', generateJwt);

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
      const transport = new StreamableHTTPServerTransport({
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

async function generateJwt(req: Request, res: Response): Promise<void> {
  const { connectedAppClientId, connectedAppSecretId, connectedAppSecretValue } = getConfig();

  const { username, scopes, source, resource, server, siteName } = req.body;
  if (!username || !scopes || !source || !resource || !server || !siteName) {
    res.status(400).json({
      error: 'username, scopes, source, resource, server, and siteName are required',
    });
    return;
  }

  const additionalPayload: Record<string, unknown> = {};
  if (resource === 'query-datasource') {
    additionalPayload.region = 'West';
  }

  const jwt = await getJwt({
    username: username as string,
    connectedApp: {
      clientId: connectedAppClientId,
      secretId: connectedAppSecretId,
      secretValue: connectedAppSecretValue,
    },
    scopes: new Set(scopes as string[]),
    additionalPayload,
  });

  res.json({
    jwt,
  });
}
