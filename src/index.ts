import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { log } from './log.js';
import { server } from './server.js';

async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info(`${server.name} v${server.version} running on stdio`);
}

try {
  await startServer();
} catch (error) {
  const message = error instanceof Error ? error.message : `${error}`;
  log.critical(`Fatal error in main(): ${message}`);
  process.exit(1);
}
