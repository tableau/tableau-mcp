#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, writeToStderr } from './logging/log.js';
import { Server, serverName, serverVersion } from './server.js';
import { startExpressServer } from './server/express.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

async function startServer(): Promise<void> {
  dotenv.config();
  const config = getConfig();

  const logLevel = isLoggingLevel(config.defaultLogLevel) ? config.defaultLogLevel : 'debug';

  switch (config.transport) {
    case 'stdio': {
      const server = new Server();
      server.registerTools();
      server.registerRequestHandlers();

      // TODO: Register resources *after* the server connects to the transport
      // once https://github.com/modelcontextprotocol/typescript-sdk/issues/893 is fixed.
      // Currently, an error is thrown: "Cannot register capabilities after connecting to transport".
      // https://github.com/modelcontextprotocol/typescript-sdk/blob/79d11dc53fda1dffcbfdad101d9832227134bf7c/src/server/mcp.ts#L591
      // https://github.com/modelcontextprotocol/typescript-sdk/blob/79d11dc53fda1dffcbfdad101d9832227134bf7c/src/server/index.ts#L149
      //
      // This will:
      //  1. Allow the server to be connected to the transport more quickly.
      //  2. Allow us to refresh the resources periodically.
      //  3. Allow the REST API request/response tracing to successfully send logging notifications.
      await server.registerResources();

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
