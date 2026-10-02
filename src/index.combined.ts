#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';

import pkg from '../package.json';
import { getDesktopConfig } from './config.desktop.js';
import { getConfig } from './config.js';
import { buildDesktopInstructions } from './desktop/instructions.js';
import { FileLogger, setFileLogger } from './logging/fileLogger.js';
import { log } from './logging/logger';
import { isNotificationLevel, notifier, setNotificationLevel } from './logging/notification.js';
import { DesktopMcpServer } from './server.desktop.js';
import { buildWebInstructions, WebMcpServer } from './server.web.js';
import { initializeWebRuntime } from './server/webRuntime.js';

const serverName = 'tableau-combined-mcp';
const serverVersion = pkg.version;

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  if (config.transport !== 'stdio') {
    throw new Error('Transport must be stdio for Desktop server');
  }

  const { serverInfoReady } = await initializeWebRuntime(config);

  const notificationLevel = isNotificationLevel(config.defaultNotificationLevel)
    ? config.defaultNotificationLevel
    : 'debug';
  if (config.loggers.has('fileLogger')) {
    setFileLogger(new FileLogger({ logDirectory: config.fileLoggerDirectory }));
  }

  await serverInfoReady;

  // The combined bundle supplies its own McpServer to both WebMcpServer and DesktopMcpServer so the
  // web and desktop tools register onto a single server. Because the SDK reads `instructions` ONLY
  // from the McpServer constructor options, compose both variants before either registers.
  const desktopConfig = getDesktopConfig();
  const instructions = `${buildWebInstructions()} ${buildDesktopInstructions({
    sessionPinned: desktopConfig.desktopSessionId !== undefined,
    profile: desktopConfig.toolProfile,
  })}`;
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
      instructions,
    },
  );

  const webMcpServer = new WebMcpServer({ mcpServer });
  await webMcpServer.registerTools();

  const desktopMcpServer = new DesktopMcpServer({ mcpServer });
  await desktopMcpServer.registerTools();
  await desktopMcpServer.registerResources();

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
