#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { getConfig } from './config.web.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { writeToStderr } from './logging/logger.js';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { DesktopMcpServer } from './server.desktop.js';
import { serverName, serverVersion } from './server.js';
import { WebMcpServer } from './server.web.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  if (config.transport !== 'stdio') {
    throw new Error('Transport must be stdio for Desktop server');
  }

  RestApi.host = config.server;

  // Start fetching server info immediately but don't block the port from opening.
  // Any failure here is fatal and logged explicitly -- no silent failures.
  // For http transport, the port opens first so health checks can succeed,
  // then we await this before declaring the server ready.
  // For stdio transport, there are no health checks, but we still await before serving.
  const serverInfoReady = getTableauServerInfo(config.server).catch((error) => {
    writeToStderr(`Fatal error initializing server info: ${getExceptionMessage(error)}`);
    process.exit(1);
  });

  const logLevel = isNotificationLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  await serverInfoReady;

  const mcpServer = new McpServer(
    {
      name: serverName,
      version: serverVersion,
    },
    {
      capabilities: {
        logging: {},
        tools: {},
      },
    },
  );

  const webMcpServer = new WebMcpServer({ mcpServer });
  await webMcpServer.registerTools();
  webMcpServer.registerRequestHandlers();

  const desktopMcpServer = new DesktopMcpServer({ mcpServer });
  await desktopMcpServer.registerTools();
  desktopMcpServer.registerRequestHandlers();

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  setNotificationLevel(webMcpServer, logLevel);
  notifier.info(webMcpServer, `${webMcpServer.name} v${webMcpServer.version} running on stdio`);

  if (config.disableLogMasking) {
    writeToStderr('⚠️ Log masking is disabled!');
  }
}

startServer().catch((error) => {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
});
