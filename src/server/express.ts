import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { Config } from '../config.js';
import { setLogLevel } from '../logging/log.js';
import { pulseInsightBundleSchema } from '../sdks/tableau/types/pulse.js';
import { Server } from '../server.js';
import { validateProtocolVersion } from './middleware.js';
import { OAuthProvider } from './oauth/provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  app.get(path, ...middleware, methodNotAllowed);
  app.delete(path, ...middleware, methodNotAllowed);
  app.use(express.static(join(__dirname, 'web')));

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
      const server = new Server();
      const transport = new StreamableHTTPServerTransport({
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
                  connect_domains: ['https://chatgpt.com'],
                  // Maps to style-src, style-src-elem, img-src, font-src, media-src etc. in the iframe CSP
                  resource_domains: ['https://*.oaistatic.com'],
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
