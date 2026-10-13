import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { getExchangeConfig } from './config.exchange.js';
import { setNotificationLevel } from './logging/notification.js';
import { ExchangeMcpServer } from './server.exchange.js';

async function startServer(): Promise<void> {
  const config = getExchangeConfig();
  const server = new ExchangeMcpServer({ config });
  await server.registerTools();
  server.mcpServer.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    setNotificationLevel(server.mcpServer, request.params.level);
    return {};
  });
  await server.mcpServer.connect(new StdioServerTransport());
  server.service.start();
}

startServer().catch((error: unknown) => {
  process.stderr.write(
    `Exchange server startup failed: ${error instanceof Error ? error.message : 'invalid configuration'}\n`,
  );
  process.exitCode = 1;
});
