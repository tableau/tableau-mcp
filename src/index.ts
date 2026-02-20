#!/usr/bin/env node
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

import { getConfig } from './config.js';
import { isLoggingLevel, log, setLogLevel, setServerLogger, writeToStderr } from './logging/log.js';
import { ServerLogger } from './logging/serverLogger.js';
import { pulseInsightBundleSchema } from './sdks/tableau/types/pulse.js';
import { Server, serverName, serverVersion } from './server.js';
import { startExpressServer } from './server/express.js';
import { getDirname } from './utils/getDirname.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

const DIST_DIR = join(getDirname(), 'web');

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
      await server.registerTools();

      // Two-part registration: tool + resource, tied together by the resource URI.
      const resourceUri = 'ui://tableau-mcp/pulse-renderer.html';

      // Register a tool with UI metadata. When the host calls this tool, it reads
      // `_meta.ui.resourceUri` to know which resource to fetch and render as an
      // interactive UI.
      registerAppTool(
        server,
        'pulse-renderer',
        {
          title: 'Render Pulse Insight',
          description:
            'Render a Pulse insight given an insight bundle. Use this tool to render a Pulse insight in a chat window.',
          inputSchema: { bundle: pulseInsightBundleSchema },
          _meta: { ui: { resourceUri } }, // Links this tool to its UI resource
        },
        async ({ bundle }): Promise<CallToolResult> => {
          return { content: [{ type: 'text', text: JSON.stringify(bundle) }] };
        },
      );

      // Register the resource, which returns the bundled HTML/JavaScript for the UI.
      registerAppResource(
        // @ts-expect-error -- extension of McpServer is confusing this
        server,
        resourceUri,
        resourceUri,
        { mimeType: RESOURCE_MIME_TYPE },
        async (): Promise<ReadResourceResult> => {
          const html = readFileSync(join(DIST_DIR, 'pulse-renderer.html'), 'utf-8');
          return {
            contents: [
              {
                uri: resourceUri,
                mimeType: RESOURCE_MIME_TYPE,
                text: html,
              },
            ],
          };
        },
      );

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
          '⚠️ TRANSPORT is "http" but OAuth is disabled! Your MCP server may not be protected from unauthorized access! By having explicitly disabled OAuth by setting the DANGEROUSLY_DISABLE_OAUTH environment variable to "true", you accept any and all risks associated with this decision.',
        );
      }

      // eslint-disable-next-line no-console -- console.log is intentional here since the transport is not stdio.
      console.log(
        `${serverName} v${serverVersion} ${config.disableSessionManagement ? 'stateless ' : ''}streamable HTTP server available at ${url}`,
      );
      break;
    }
  }

  if (config.disableLogMasking) {
    writeToStderr('⚠️ Log masking is disabled!');
  }
}

startServer().catch((error) => {
  writeToStderr(`Fatal error when starting the server: ${getExceptionMessage(error)}`);
  process.exit(1);
});
