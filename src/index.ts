#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { WebMcpServer } from './server.web.js';
import { startExpressServer } from './server/express.js';

const serverVersion = pkg.version;

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  RestApi.host = config.server;

  // Start fetching server info immediately but don't block the port from opening.
  // Any failure here is fatal and logged explicitly -- no silent failures.
  // For http transport, the port opens first so health checks can succeed,
  // then we await this before declaring the server ready.
  // For stdio transport, there are no health checks, but we still await before serving.
  const serverInfoReady = getTableauServerInfo(config.server).catch((error) => {
    log({
      message: 'Fatal error initializing server info',
      level: 'error',
      logger: 'startup',
      error,
    });
    process.exit(1);
  });

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

      const server = new WebMcpServer();
      await server.registerTools();
      server.mcpServer.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
        setNotificationLevel(server.mcpServer, request.params.level);
        return {};
      });

      const transport = new StdioServerTransport();
      await server.mcpServer.connect(transport);

      setNotificationLevel(server.mcpServer, notificationLevel);
      notifier.info(server.mcpServer, `${server.name} v${server.version} running on stdio`);
      break;
    }
    case 'http': {
      const { url } = await startExpressServer({
        basePath: 'tableau-mcp',
        config,
        logLevel: notificationLevel,
      });

      // Port is now open. Wait for server info before logging the ready message.
      await serverInfoReady;

      if (!config.oauth.enabled) {
        log({
          message:
            '⚠️ TRANSPORT is "http" but OAuth is disabled! Your MCP server may not be protected from unauthorized access! By having explicitly disabled OAuth by setting the DANGEROUSLY_DISABLE_OAUTH environment variable to "true", you accept any and all risks associated with this decision.',
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
    error,
  });
  process.exit(1);
});
