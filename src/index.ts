#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import readline from 'readline/promises';

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

      if (!config.oauth.enabled) {
        console.warn(
          '⚠️ TRANSPORT is "http" but OAuth is disabled! Your MCP server may not be protected from unauthorized access!',
        );

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const input = (
          await rl.question('⚠️ To accept these risks, please type "I accept" and press Enter.\n> ')
        )
          .toLocaleLowerCase()
          .replaceAll('"', '')
          .trim();

        if (input !== 'i accept') {
          // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
          console.log('Goodbye 👋');
          process.exit(1);
        }
      }

      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(
        `${serverName} v${serverVersion} stateless streamable HTTP server available at ${url}`,
      );
      break;
    }
  }

  if (config.disableLogMasking) {
    writeToStderr('⚠️ Log masking is disabled!');
  }
}

try {
  await startServer();
} catch (error) {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
}
