#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, setServerLogger, writeToStderr } from './logging/log.js';
import { ServerLogger } from './logging/serverLogger.js';
import { Server, serverName, serverVersion } from './server.js';
import { startExpressServer } from './server/express.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  const logLevel = isLoggingLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';
  if (config.enableServerLogging) {
    setServerLogger(new ServerLogger({ logDirectory: config.serverLogDirectory }));
  }

  switch (config.transport) {
    case 'stdio': {
      const server = new Server();
      server.registerTools();
      server.registerRequestHandlers();

      const transport = new StdioServerTransport();
      await server.connect(transport);

      setLogLevel(server, logLevel);
      log.info(server, `${server.name} v${server.version} running on stdio`);
      break;
    }
    case 'http': {
      const { url } = await startExpressServer({ basePath: serverName, config, logLevel });

      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(
        `${serverName} v${serverVersion} stateless streamable HTTP server available at ${url}`,
      );
      break;
    }
  }

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
