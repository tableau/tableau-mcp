#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { getConfig } from './config.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { writeToStderr } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { Server, serverName, serverVersion } from './server.js';
import { startExpressServer } from './server/express.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();
  // Initializing REST API host then getting server info for the first time
  // which will cache the server info and initialize our REST API version for subsequent requests
  RestApi.host = config.server;
  await getTableauServerInfo(config.server);
  const logLevel = isNotificationLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  switch (config.transport) {
    case 'stdio': {
      const server = new Server();
      await server.registerTools();
      server.registerRequestHandlers();

      const transport = new StdioServerTransport();
      await server.connect(transport);

      setNotificationLevel(server, logLevel);
      notifier.info(server, `${server.name} v${server.version} running on stdio`);
      break;
    }
    case 'http': {
      const { url } = await startExpressServer({ basePath: serverName, config, logLevel });

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
    writeToStderr('⚠️ Log masking is disabled!');
  }
}

startServer().catch((error) => {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
});
