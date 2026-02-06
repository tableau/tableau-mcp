import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';
import { join } from 'path';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { pulseInsightBundleSchema } from '../sdks/tableau/types/pulse.js';
import { Server } from '../server.js';
import { createSession, getSession, Session } from '../sessions.js';
import { getDirname } from '../utils/getDirname.js';
import { handlePingRequest, validateProtocolVersion } from './middleware.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';
import { OAuthProvider } from './oauth/provider.js';
import { TableauAuthInfo } from './oauth/schemas.js';
import { AuthenticatedRequest } from './oauth/types.js';

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
  const app = express();

  // https://expressjs.com/en/guide/behind-proxies.html
  app.set('trust proxy', 1);

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
  app.use(express.static(join(getDirname(), 'web')));

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

        server.registerResource(
          'pulse-renderer',
          'ui://widget/pulse-renderer.html',
          {},
          async () => ({
            contents: [
              {
                uri: 'ui://widget/pulse-renderer.html',
                mimeType: 'text/html+skybridge',
                text: fs.readFileSync(join(__dirname, 'web', 'pulse-renderer.html'), 'utf8'),
                _meta: {
                  /*
                  Renders the widget within a rounded border and shadow.
                  Otherwise, the HTML is rendered full-bleed in the conversation
                */
                  'openai/widgetPrefersBorder': true,

                  /*
                  Assigns a subdomain for the HTML.
                  When set, the HTML is rendered within `chatgpt-com.web-sandbox.oaiusercontent.com`
                  It's also used to configure the base url for external links.
                */
                  'openai/widgetDomain': 'https://chatgpt.com',

                  /*
                  Required to make external network requests from the HTML code.
                  Also used to validate `openai.openExternal()` requests.
                */
                  'openai/widgetCSP': {
                    // Maps to `connect-src` rule in the iframe CSP
                    connect_domains: [
                      'https://chatgpt.com',
                      'https://tableau-mcp-oauth-4cfa19926d6e.herokuapp.com',
                    ],
                    // Maps to style-src, style-src-elem, img-src, font-src, media-src etc. in the iframe CSP
                    resource_domains: [
                      'https://*.oaistatic.com',
                      'https://tableau-mcp-oauth-4cfa19926d6e.herokuapp.com',
                    ],
                  },
                },
              },
            ],
          }),
        );

        server.registerTool(
          'render-pulse-insight',
          {
            title: 'Render Pulse Insight',
            description:
              'Render a Pulse insight given an insight bundle. Use this tool to render a Pulse insight in a chat window.',
            _meta: {
              // associate this tool with the HTML template
              'openai/outputTemplate': 'ui://widget/pulse-renderer.html',
              // labels to display in ChatGPT when the tool is called
              'openai/toolInvocation/invoking': 'Rendering the Pulse insight',
              'openai/toolInvocation/invoked': 'Rendered the Pulse insight',
            },
            inputSchema: { bundle: pulseInsightBundleSchema },
          },
          async ({ bundle }) => {
            return {
              content: [{ type: 'text', text: 'Rendered the Pulse insight!' }],
              structuredContent: {
                bundle,
              },
            };
          },
        );

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
