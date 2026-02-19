import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolResult,
  isInitializeRequest,
  LoggingLevel,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync, readFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { join } from 'path';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { Server } from '../server.js';
import { createSession, getSession, Session } from '../sessions.js';
import { getDirname } from '../utils/getDirname.js';
import { handlePingRequest, validateProtocolVersion } from './middleware.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';
import { OAuthProvider } from './oauth/provider.js';
import { TableauAuthInfo } from './oauth/schemas.js';
import { AuthenticatedRequest } from './oauth/types.js';

const SESSION_ID_HEADER = 'mcp-session-id';

const DIST_DIR = join(getDirname(), 'web');

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
      exposedHeaders: [SESSION_ID_HEADER, 'x-session-id'],
    }),
  );

  if (config.trustProxyConfig !== null) {
    // https://expressjs.com/en/guide/behind-proxies.html
    app.set('trust proxy', config.trustProxyConfig);
  }

  const middleware: Array<RequestHandler> = [handlePingRequest];
  if (config.oauth.enabled) {
    const oauthProvider = new OAuthProvider();
    oauthProvider.setupRoutes(app);
    middleware.push(oauthProvider.authMiddleware);
    middleware.push(validateProtocolVersion);
  }

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

        await connect(server, transport, logLevel, getTableauAuthInfo(req.auth));
      } else {
        const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;

        let session: Session | undefined;
        if (sessionId && (session = getSession(sessionId))) {
          transport = session.transport;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          const clientInfo = req.body.params.clientInfo;
          transport = createSession({ clientInfo });

          const server = new Server({ clientInfo });
          await connect(server, transport, logLevel, getTableauAuthInfo(req.auth));
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
): Promise<void> {
  await server.registerTools(authInfo);

  // Two-part registration: tool + resource, tied together by the resource URI.
  const resourceUri = 'ui://tableau-mcp/pulse-renderer.html';

  // Register a tool with UI metadata. When the host calls this tool, it reads
  // `_meta.ui.resourceUri` to know which resource to fetch and render as an
  // interactive UI.
  registerAppTool(
    server,
    'get-time',
    {
      title: 'Render Pulse Insight',
      description: 'Renders a Pulse insight in a new tab.',
      inputSchema: {},
      _meta: { ui: { resourceUri } }, // Links this tool to its UI resource
    },
    async (): Promise<CallToolResult> => {
      const time = new Date().toISOString();
      return { content: [{ type: 'text', text: time }] };
    },
  );

  // Register the resource, which returns the bundled HTML/JavaScript for the UI.
  registerAppResource(
    // @ts-expect-error -- extension of McpServer is confusing this
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = readFileSync(join(DIST_DIR, 'pulse-renderer.html'), 'utf-8');
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  server.registerRequestHandlers();

  await server.connect(transport);
  setLogLevel(server, logLevel);
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
