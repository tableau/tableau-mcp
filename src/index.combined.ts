#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { DesktopMcpServer } from './server.desktop.js';
import { buildWebInstructions, WebMcpServer } from './server.web.js';

const serverName = 'tableau-combined-mcp';
const serverVersion = pkg.version;

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
    log({
      message: 'Fatal error initializing server info',
      level: 'error',
      logger: 'startup',
      data: error,
    });
    process.exit(1);
  });

  const notificationLevel = isNotificationLevel(config.defaultNotificationLevel)
    ? config.defaultNotificationLevel
    : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  await serverInfoReady;

  // The combined bundle supplies its own McpServer to both WebMcpServer and DesktopMcpServer so the
  // web and desktop tools register onto a single server. Because the SDK reads `instructions` ONLY
  // from the McpServer constructor options (never settable afterward), we MUST build it here with the
  // web instructions — otherwise WebMcpServer's composed guidance would be silently discarded on the
  // provided-mcpServer path. Kept in lockstep with the default path via buildWebInstructions(); the
  // base Server constructor asserts the two match.
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
      instructions: buildWebInstructions(),
    },
  );

  const webMcpServer = new WebMcpServer({ mcpServer });
  await webMcpServer.registerTools();

  const desktopMcpServer = new DesktopMcpServer({ mcpServer });
  await desktopMcpServer.registerTools();

  mcpServer.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    setNotificationLevel(desktopMcpServer.mcpServer, request.params.level);
    return {};
  });

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  setNotificationLevel(mcpServer, notificationLevel);
  notifier.info(mcpServer, `${serverName} v${serverVersion} running on stdio`);

  if (config.disableLogMasking) {
    log({ message: '⚠️ Log masking is disabled!', level: 'info', logger: 'startup' });
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
