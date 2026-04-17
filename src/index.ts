#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { getConfig } from './config.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { Server, serverName, serverVersion } from './server.js';
import { startExpressServer } from './server/express.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

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
      message: `Fatal error initializing server info: ${getExceptionMessage(error)}`,
      level: 'error',
      logger: 'startup',
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

      const server = new Server();
      await server.registerTools();
      server.registerRequestHandlers();

      const transport = new StdioServerTransport();
      await server.connect(transport);

      setNotificationLevel(server, notificationLevel);
      notifier.info(server, `${server.name} v${server.version} running on stdio`);
      break;
    }
    case 'http': {
      const { url } = await startExpressServer({
        basePath: serverName,
        config,
        logLevel: notificationLevel,
      });

      // Port is now open. Wait for server info before logging the ready message.
      await serverInfoReady;

      if (!config.oauth.enabled) {
        console.warn(
          '⚠️ TRANSPORT is "http" but OAuth is disabled! Your MCP server may not be protected from unauthorized access! By having explicitly disabled OAuth by setting the DANGEROUSLY_DISABLE_OAUTH environment variable to "true", you accept any and all risks associated with this decision.',
        );
      }

      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(
        `${serverName} v${serverVersion} ${config.disableSessionManagement ? 'stateless ' : ''}streamable HTTP server available at ${url}`,
      );
      break;
    }
  }

  if (config.disableLogMasking) {
    log({ message: 'Log masking is disabled!', level: 'info', logger: 'startup' });
  }
}

startServer().catch((error) => {
  log({
    message: `Fatal error when starting the server: ${getExceptionMessage(error)}`,
    level: 'error',
    logger: 'startup',
  });
  process.exit(1);
});
