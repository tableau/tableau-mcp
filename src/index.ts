#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, writeToStderr } from './logging/log.js';
import { Server } from './server.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  const config = getConfig();

  const server = new Server();
  server.registerTools();
  server.registerRequestHandlers();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  setLogLevel(server, isLoggingLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug');

  log.info(server, `${server.name} v${server.version} running on stdio`);
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
