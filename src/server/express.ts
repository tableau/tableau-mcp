import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config } from '../config.js';
import { setNotificationLevel } from '../logging/notification.js';
import { getOverridableConfig } from '../overridableConfig.js';
import { Server } from '../server.js';
import { createSession, getSession, Session } from '../sessions.js';
import { latencyMiddleware } from './latencyMiddleware.js';
import { handlePingRequest } from './middleware.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';
import { EmbeddedOAuthProvider, TableauOAuthProvider } from './oauth/provider.js';
import { TableauAuthInfo } from './oauth/schemas.js';
import { AuthenticatedRequest } from './oauth/types.js';
import { passthroughAuthMiddleware, X_TABLEAU_AUTH_HEADER } from './passthroughAuthMiddleware.js';
import { requestOverrideMiddleware } from './requestOverrideMiddleware.js';

const SESSION_ID_HEADER = 'mcp-session-id';

export async function startExpressServer({
  basePath,
  config,
  logLevel,
}: {
  basePath: string;
  config: Config;
  logLevel: LoggingLevel;
}): Promise<{ url: string; app: express.Application; server: http.Server }> {
  // getting overridable config, but we intentionally omit site and request overrides
  // since we are only interested in the values set by the ENVIRONMENT variables.
  const configWithoutOverrides = getOverridableConfig();

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded());
  if (config.enablePassthroughAuth) {
    // cookie-parser is used to parse the workgroup_session_id cookie for passthrough auth
    app.use(cookieParser());
  }

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
        X_TABLEAU_AUTH_HEADER,
      ],
      exposedHeaders: [SESSION_ID_HEADER, 'x-session-id'],
    }),
  );

  const middleware: Array<RequestHandler> = [handlePingRequest];
  if (config.enablePassthroughAuth) {
    middleware.push(passthroughAuthMiddleware());
  }

  if (
    configWithoutOverrides.allowedRequestOverrides.size !== 0 ||
    config.allowSitesToConfigureRequestOverrides
  ) {
    middleware.push(requestOverrideMiddleware());
  }

  if (config.oauth.enabled) {
    const oauthProvider = config.oauth.embeddedAuthzServer
      ? new EmbeddedOAuthProvider()
      : new TableauOAuthProvider();

    oauthProvider.setupRoutes(app);
    middleware.push(oauthProvider.authMiddleware);
  }
  middleware.push(latencyMiddleware());

  const path = `/${basePath}`;
  app.post(path, ...middleware, createMcpServer);
  app.get(
    path,
    ...middleware,
    config.disableSessionManagement ? methodNotAllowed : handleSessionRequest,
  );
  app.delete(
    path,
    ...middleware,
    config.disableSessionManagement ? methodNotAllowed : handleSessionRequest,
  );

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

  async function createMcpServer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      let transport: StreamableHTTPServerTransport;

      if (config.disableSessionManagement) {
        const server = new Server();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        res.on('close', () => {
          transport.close();
          server.close();
        });

        await connect(server, transport, logLevel, getTableauAuthInfo(req.auth), req.overrides);
      } else {
        const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;

        let session: Session | undefined;
        if (sessionId && (session = getSession(sessionId))) {
          transport = session.transport;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          const clientInfo = req.body.params.clientInfo;
          transport = createSession({ clientInfo });

          const server = new Server({ clientInfo });
          await connect(server, transport, logLevel, getTableauAuthInfo(req.auth), req.overrides);
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

async function connect(
  server: Server,
  transport: StreamableHTTPServerTransport,
  logLevel: LoggingLevel,
  authInfo: TableauAuthInfo | undefined,
  requestOverrides: Record<string, string> | undefined,
): Promise<void> {
  await server.registerTools(authInfo, requestOverrides);
  server.registerRequestHandlers();

  await server.connect(transport);
  setNotificationLevel(server, logLevel);
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

async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;

  let session: Session | undefined;
  if (!sessionId || !(session = getSession(sessionId))) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  await session.transport.handleRequest(req, res);
}
