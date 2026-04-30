import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import { getDesktopConfig } from './config.desktop.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { DesktopMcpServer } from './server.desktop.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getDesktopConfig();

  const notificationLevel = isNotificationLevel(config.defaultNotificationLevel)
    ? config.defaultNotificationLevel
    : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  if (config.transport !== 'stdio') {
    throw new Error('Transport must be stdio for Desktop server');
  }

  const server = new DesktopMcpServer();
  await server.registerTools();
  await server.registerResources();
  server.mcpServer.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    setNotificationLevel(server.mcpServer, request.params.level);
    return {};
  });

  const transport = new StdioServerTransport();
  await server.mcpServer.connect(transport);

  setNotificationLevel(server.mcpServer, notificationLevel);
  notifier.info(server.mcpServer, `${server.name} v${server.version} running on stdio`);
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
