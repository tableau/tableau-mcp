#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import fs, { existsSync } from 'fs';
import http from 'http';
import https from 'https';

import { Config, getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, writeToStderr } from './logging/log.js';
import {
  rateLimitMiddleware,
  requestSizeLimit,
  validateProtocolVersion,
} from './server/middleware.js';
import { OAuthProvider } from './server/oauth.js';
import { Server, serverName, serverVersion } from './server/server.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  const logLevel = isLoggingLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';

  switch (config.transport) {
    case 'stdio': {
      const server = new Server();
      const transport = new StdioServerTransport();
      server.registerTools();
      server.registerRequestHandlers();
      await server.connect(transport);
      setLogLevel(server, logLevel);
      log.info(server, `${server.name} v${server.version} running on stdio`);
      break;
    }
    case 'http': {
      const url = await startExpressServer(config, logLevel);
      console.log(
        `${serverName} v${serverVersion} stateless streamable HTTP server available at ${url}`,
      );
      break;
    }
  }

  if (config.disableLogMasking) {
    writeToStderr('Log masking is disabled!');
  }
}

try {
  await startServer();
} catch (error) {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
}

async function startExpressServer(config: Config, logLevel: LoggingLevel): Promise<string> {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded());

  app.use(
    cors({
      origin: true,
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

  const oauthProvider = new OAuthProvider();
  oauthProvider.setupRoutes(app);

  const mcpMiddleware = [
    oauthProvider.authMiddleware(),
    rateLimitMiddleware(60000, 100), // 100 requests per minute
    validateProtocolVersion,
    requestSizeLimit(10 * 1024 * 1024), // 10MB max
  ];

  const path = serverName;
  app.post(`/${path}`, ...mcpMiddleware, async (req: Request, res: Response) => {
    try {
      const server = new Server();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
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
  });

  app.get(`/${path}`, ...mcpMiddleware, async (_req: Request, res: Response) => {
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
  });

  app.delete(`/${path}`, ...mcpMiddleware, async (_req: Request, res: Response) => {
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
  });

  if (config.sslKey && config.sslCert) {
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
        .listen(config.httpPort, () => resolve(`https://localhost:${config.httpPort}/${path}`));
    });
  } else {
    return new Promise((resolve) => {
      http
        .createServer(app)
        .listen(config.httpPort, () => resolve(`http://localhost:${config.httpPort}/${path}`));
    });
  }
}
