import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
  toWebRequest,
} from '@modelcontextprotocol/node';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  isInitializeRequest,
  isLegacyRequest,
  LoggingLevel,
} from '@modelcontextprotocol/server';
import { AsyncLocalStorage } from 'async_hooks';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Request, RequestHandler, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config } from '../config.js';
import { McpSiteSettingsUnavailableError } from '../errors/mcpToolError.js';
import { getFeatureGate } from '../features/init.js';
import { logClientInitialized, logModernClientOnce } from '../logging/clientInitialized.js';
import { log } from '../logging/logger.js';
import { setNotificationLevel } from '../logging/notification.js';
import { ClientInfo, Server } from '../server.js';
import { WebMcpServer } from '../server.web.js';
import { createSession, getSession, Session } from '../sessions.js';
import { OAUTH_AUTH_CHALLENGE_GUIDANCE } from '../utils/authErrorMessage.js';
import { latencyMiddleware } from './latencyMiddleware.js';
import { ClientCapabilitiesWithUiExtension } from './mcpUiCapability.js';
import { handlePingRequest } from './middleware.js';
import { getOAuthChallenge } from './oauth/authMiddleware.js';
import { getTableauAuthInfo } from './oauth/getTableauAuthInfo.js';
import { createOAuthProvider } from './oauth/provider.js';
import { TableauAuthInfo } from './oauth/schemas.js';
import { getSessionBinding } from './oauth/siteBinding.js';
import { AuthenticatedRequest } from './oauth/types.js';
import {
  INVALID_TOKEN_BODY,
  passthroughAuthMiddleware,
  X_TABLEAU_AUTH_HEADER,
} from './passthroughAuthMiddleware.js';
import { X_TABLEAU_MCP_CONFIG_HEADER } from './requestUtils.js';

const SESSION_ID_HEADER = 'mcp-session-id';

export async function startExpressServer({
  basePath,
  config,
  logLevel,
  host,
}: {
  basePath: string;
  config: Config;
  logLevel: LoggingLevel;
  // Interface to bind. Empty/undefined binds all interfaces (Docker/Heroku rely on this).
  host?: string;
}): Promise<{ url: string; app: express.Application; server: http.Server }> {
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
        // 2026-07-28 requires these on every request (Mcp-Name on tools/call).
        'Mcp-Method',
        'Mcp-Name',
        X_TABLEAU_AUTH_HEADER,
        X_TABLEAU_MCP_CONFIG_HEADER,
      ],
      exposedHeaders: [SESSION_ID_HEADER, 'x-session-id'],
    }),
  );

  const middleware: Array<RequestHandler> = [handlePingRequest];
  if (config.enablePassthroughAuth) {
    middleware.push(passthroughAuthMiddleware());
  }

  if (config.oauth.enabled) {
    const oauthProvider = createOAuthProvider(config);

    oauthProvider.setupRoutes(app);
    middleware.push(oauthProvider.authMiddleware);
  }
  middleware.push(latencyMiddleware());

  // 2026-07-28 traffic is stateless per request: one factory-built server per POST. The request rides
  // an AsyncLocalStorage so the factory can read the per-request client envelope, which it needs
  // before registration (MCP Apps gating, client display name).
  const modernRequest = new AsyncLocalStorage<{
    req: AuthenticatedRequest;
    setupError?: unknown;
  }>();
  const modernMcpHandler = createMcpHandler(
    async ({ authInfo }) => {
      const context = modernRequest.getStore();
      const meta = getRequestMeta(context?.req.body);
      // The SDK calls the factory only after validating the envelope against its 2026-07-28 schema
      // (a malformed one gets a 400), so rejected requests aren't logged and the casts below only narrow.
      logModernClientOnce(meta);
      const server = new WebMcpServer({
        clientInfo: meta?.[CLIENT_INFO_META_KEY] as ClientInfo | undefined,
        capabilities: meta?.[CLIENT_CAPABILITIES_META_KEY] as
          ClientCapabilitiesWithUiExtension | undefined,
        clientId: authInfo?.clientId,
      });
      try {
        await server.registerTools(getTableauAuthInfo(authInfo), authInfo?.scopes);
      } catch (error) {
        if (context) context.setupError = error;
        throw error;
      }
      setNotificationLevel(server.mcpServer, logLevel, { silent: true });
      return server.mcpServer;
    },
    {
      legacy: 'reject',
      onerror: (error) =>
        log({
          message: 'Error serving 2026-07-28 MCP request',
          level: 'error',
          logger: 'server',
          data: error,
        }),
    },
  );
  // The SDK answers a factory error with a bare 500. Swap in the 2025 path's mapping so a site
  // settings 401 still carries the OAuth challenge and a Tableau 4xx stays a 4xx.
  const modernHandler = toNodeHandler({
    fetch: async (request, options) => {
      const response = await modernMcpHandler.fetch(request, options);
      const context = modernRequest.getStore();
      if (context?.setupError === undefined) return response;
      const { status, headers, body } = await describeRequestError(context.setupError, context.req);
      return globalThis.Response.json(body, { status, headers });
    },
  });

  async function routeMcpPost(req: AuthenticatedRequest, res: Response): Promise<void> {
    // Without a parsed JSON body there is nothing to classify; the 2025 transport answers it.
    if (!(await isProtocol2026Enabled()) || req.body === undefined) {
      return createMcpServer(req, res);
    }

    try {
      if (await isLegacyRequest(await toWebRequest(req, req.body), req.body)) {
        return createMcpServer(req, res);
      }
      await modernRequest.run({ req }, () => modernHandler(req, res, req.body));
    } catch (error) {
      log({ message: 'Error routing MCP request', level: 'error', logger: 'server', data: error });
      if (!res.headersSent) {
        await sendRequestError(error, req, res);
      }
    }
  }

  const path = `/${basePath}`;
  app.post(path, ...middleware, routeMcpPost);
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

  // An empty host is passed to listen() as undefined, which makes Node bind all interfaces.
  // A loopback bind is reported as 127.0.0.1 because `localhost` can resolve to ::1, which a
  // 127.0.0.1 listener doesn't serve.
  // IPv6 literals must be bracketed to form a valid URL.
  const urlHost = host?.includes(':') ? `[${host}]` : host || 'localhost';
  const useSsl = !!(config.sslKey && config.sslCert);
  if (!useSsl) {
    return new Promise((resolve) => {
      const server = http
        .createServer(app)
        .listen(config.httpPort, host || undefined, () =>
          resolve({ url: `http://${urlHost}:${config.httpPort}/${basePath}`, app, server }),
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
      .listen(config.httpPort, host || undefined, () =>
        resolve({ url: `https://${urlHost}:${config.httpPort}/${basePath}`, app, server }),
      );
  });

  // The 2025 handshake has no server-side "initialized" hook in stateless mode (each request gets
  // a fresh server), so log from the initialize request itself. 2026-07-28 clients send no
  // initialize; routeMcpPost logs them on first sight via logModernClientOnce.
  function logHttpClientInitialized(body: unknown): void {
    if (!isInitializeRequest(body)) return;
    logClientInitialized({
      protocolVersion: body.params.protocolVersion,
      clientInfo: body.params.clientInfo,
      capabilities: body.params.capabilities,
    });
  }

  async function createMcpServer(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      let transport: NodeStreamableHTTPServerTransport;

      if (config.disableSessionManagement) {
        const capabilities = isInitializeRequest(req.body)
          ? req.body.params.capabilities
          : undefined;
        const clientId = req.auth?.clientId;
        const server = new WebMcpServer({ capabilities, clientId });
        transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        res.on('close', () => {
          transport.close();
          server.mcpServer.close();
        });

        await connect(server, transport, logLevel, getTableauAuthInfo(req.auth), req.auth?.scopes);
        logHttpClientInitialized(req.body);
      } else {
        const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;

        let session: Session | undefined;
        if (sessionId && (session = getSession(sessionId))) {
          if (!sessionBelongsToRequest(session, req)) {
            rejectSessionMismatch(res);
            return;
          }

          transport = session.transport;
        } else if (!sessionId && isInitializeRequest(req.body)) {
          const clientInfo = req.body.params.clientInfo;
          const capabilities = req.body.params.capabilities;
          const clientId = req.auth?.clientId;
          transport = createSession({
            clientInfo,
            capabilities,
            clientId,
            authBinding: getSessionBinding(getTableauAuthInfo(req.auth)),
          });

          const server = new WebMcpServer({ clientInfo, capabilities, clientId });
          await connect(
            server,
            transport,
            logLevel,
            getTableauAuthInfo(req.auth),
            req.auth?.scopes,
          );
          logHttpClientInitialized(req.body);
        } else {
          log({
            message: 'Rejected request: no valid session ID and not an initialize request',
            level: 'error',
            logger: 'server',
          });
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
      log({
        message: 'Error handling MCP request',
        level: 'error',
        logger: 'server',
        data: error,
      });
      if (!res.headersSent) {
        await sendRequestError(error, req, res);
      }
    }
  }
}

type RequestErrorResponse = { status: number; headers?: Record<string, string>; body: unknown };

async function describeRequestError(
  error: unknown,
  req: AuthenticatedRequest,
): Promise<RequestErrorResponse> {
  // A site settings failure carries a curated message and the upstream status, so a Tableau 4xx stays a 4xx.
  const siteSettingsError = error instanceof McpSiteSettingsUnavailableError ? error : undefined;
  const status = siteSettingsError?.statusCode ?? 500;
  if (status === 401) {
    if (getTableauAuthInfo(req.auth)?.type === 'Passthrough') {
      return { status, body: INVALID_TOKEN_BODY };
    }
    // Any rejected connection with 401 status code must issue OAuth challenge
    return {
      status,
      headers: {
        'WWW-Authenticate': await getOAuthChallenge(req.body, { invalidToken: true }),
      },
      body: {
        error: 'invalid_token',
        error_description: `${siteSettingsError?.message} ${OAUTH_AUTH_CHALLENGE_GUIDANCE}`,
      },
    };
  }
  return {
    status,
    body: {
      jsonrpc: '2.0',
      error: {
        code: status < 500 ? -32000 : -32603,
        message: siteSettingsError?.message ?? 'Internal server error',
      },
      id: null,
    },
  };
}

async function sendRequestError(
  error: unknown,
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const { status, headers, body } = await describeRequestError(error, req);
  res
    .status(status)
    .set(headers ?? {})
    .json(body);
}

async function connect(
  server: Server,
  transport: NodeStreamableHTTPServerTransport,
  logLevel: LoggingLevel,
  authInfo: TableauAuthInfo | undefined,
  grantedScopes: ReadonlyArray<string> | undefined,
): Promise<void> {
  await server.registerTools(authInfo, grantedScopes);
  server.mcpServer.server.setRequestHandler('logging/setLevel', async (request) => {
    setNotificationLevel(server.mcpServer, request.params.level);
    return {};
  });

  await server.mcpServer.connect(transport);
  setNotificationLevel(server.mcpServer, logLevel);
  log({ message: 'MCP server connected to transport', level: 'debug', logger: 'server' });
}

// Read per request so a runtime-backed gate can roll the route out or back without a restart.
// A gate failure keeps the request on the 2025 path.
async function isProtocol2026Enabled(): Promise<boolean> {
  try {
    return await getFeatureGate().isFeatureEnabled('mcp-protocol-2026');
  } catch {
    return false;
  }
}

function getRequestMeta(body: unknown): Record<string, unknown> | undefined {
  const params = (body as { params?: { _meta?: unknown } } | undefined)?.params;
  const meta = params?._meta;
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : undefined;
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

// A session is pinned to the principal, server, and site that initialized it. Any change between
// requests (including a different valid bearer replayed with someone else's session ID) fails closed.
function sessionBelongsToRequest(session: Session, req: AuthenticatedRequest): boolean {
  return session.authBinding === getSessionBinding(getTableauAuthInfo(req.auth));
}

function rejectSessionMismatch(res: Response): void {
  log({
    message: 'Rejected request: session is bound to a different principal or site',
    level: 'error',
    logger: 'server',
  });
  res.status(403).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Forbidden: session does not match the authenticated identity',
    },
    id: null,
  });
}

async function handleSessionRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const sessionId = req.headers[SESSION_ID_HEADER] as string | undefined;

  let session: Session | undefined;
  if (!sessionId || !(session = getSession(sessionId))) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  if (!sessionBelongsToRequest(session, req)) {
    rejectSessionMismatch(res);
    return;
  }

  await session.transport.handleRequest(req, res);
}
