#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { getDesktopConfig } from './config.desktop.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { writeToStderr } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { DesktopMcpServer } from './server.desktop.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getDesktopConfig();

  const logLevel = isNotificationLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  if (config.transport !== 'stdio') {
    throw new Error('Transport must be stdio for Desktop server');
  }

  const server = new DesktopMcpServer();
  await server.registerTools();
  server.registerRequestHandlers();

  const transport = new StdioServerTransport();
  await server.mcpServer.connect(transport);

  setNotificationLevel(server, logLevel);
  notifier.info(server, `${server.name} v${server.version} running on stdio`);
}

startServer().catch((error) => {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
});
