#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel } from './logging/log.js';
import { server } from './server.js';

async function startServer(): Promise<void> {
  const config = getConfig();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  setLogLevel(isLoggingLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug');

  log.info(`${server.name} v${server.version} running on stdio`);
  if (config.disableLogMasking) {
    process.stderr.write('Log masking is disabled!');
  }
}

try {
  await startServer();
} catch (error) {
  const message = error instanceof Error ? error.message : `${error}`;
  process.stderr.write(`Fatal error when starting the server:, ${message}`);
  process.exit(1);
}
