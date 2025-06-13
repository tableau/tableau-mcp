#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, writeToStderr } from './logging/log.js';
import { Server } from './server.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';
import invariant from './utils/invariant.js';

async function startServer(): Promise<void> {
  const config = getConfig();

  let server: Server | undefined;
  if (config.transport === 'stdio') {
    server = new Server();
    server.registerTools();
    server.registerRequestHandlers();

    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  invariant(server);
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
