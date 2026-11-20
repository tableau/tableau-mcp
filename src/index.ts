#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import dotenv from 'dotenv';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger.js';
import { isNotificationLevel, setNotificationLevel } from './logging/notification.js';
import { WebMcpServer } from './server.web.js';
import { startExpressServer } from './server/express.js';
import { initializeWebRuntime } from './server/webRuntime.js';

const serverVersion = pkg.version;

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();
  const { serverInfoReady } = await initializeWebRuntime(config);

  log({
    message: `Config resolved: transport=${config.transport}, auth=${config.auth}, server=${config.server}`,
    level: 'info',
    logger: 'startup',
  });

  const notificationLevel = isNotificationLevel(config.defaultNotificationLevel)
    ? config.defaultNotificationLevel
    : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  switch (config.transport) {
    case 'stdio': {
      await serverInfoReady;

      // serveStdio builds an instance per connection (and per discarded server/discover probe)
      // and serves both the 2025 handshake and 2026-07-28 per-request traffic.
      serveStdio(
        async () => {
          const server = new WebMcpServer();
          await server.registerTools();
          server.mcpServer.server.setRequestHandler('logging/setLevel', async (request) => {
            setNotificationLevel(server.mcpServer, request.params.level);
            return {};
          });
          setNotificationLevel(server.mcpServer, notificationLevel, { silent: true });
          return server.mcpServer;
        },
        {
          onerror: (error) =>
            log({ message: 'stdio error', level: 'error', logger: 'stdio', data: error }),
        },
      );

      log({
        message: `tableau-mcp v${serverVersion} running on stdio`,
        level: 'info',
        logger: 'startup',
      });
      break;
    }
    case 'http': {
      const { url } = await startExpressServer({
        basePath: 'tableau-mcp',
        config,
        logLevel: notificationLevel,
        // Empty by default (all interfaces) so the Docker image and Heroku keep working.
        host: config.httpHost,
      });

      // Port is now open. Wait for server info before logging the ready message.
      await serverInfoReady;

      if (!config.oauth.enabled && config.auth !== 'passthrough') {
        log({
          message:
            '⚠️ TRANSPORT is "http" but OAuth is disabled! Your MCP server may not be protected from unauthorized access. Non-OAuth HTTP usage is intended only for testing/prototyping or deployments that are licensed and approved for usage-based licensing (UBL). For general multi-user HTTP deployments, prefer OAuth. By explicitly disabling OAuth with DANGEROUSLY_DISABLE_OAUTH="true", confirm this matches your Tableau licensing/security guidance.',
          level: 'info',
          logger: 'startup',
        });
      }

      log({
        message: `tableau-mcp v${serverVersion} ${config.disableSessionManagement ? 'stateless ' : ''}streamable HTTP server available at ${url}`,
        level: 'info',
        logger: 'startup',
      });
      break;
    }
  }

  if (config.disableLogMasking) {
    log({ message: '⚠️ Log masking is disabled!', level: 'info', logger: 'startup' });
  }

  if (config.breakGlassDisableGlobally) {
    log({
      message:
        '⚠️ BREAK_GLASS_DISABLE_GLOBALLY is enabled! This means that the MCP server will be disabled globally and will return errors to all users!',
      level: 'info',
      logger: 'startup',
    });
  }
}

startServer().catch((error) => {
  log({
    message: 'Fatal error when starting the server',
    level: 'error',
    logger: 'startup',
    data: error,
  });
  process.exit(1);
});
