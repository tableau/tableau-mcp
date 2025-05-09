import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' assert { type: 'json' };
import { setLogLevel } from './log.js';
import { listFieldsTool } from './tools/listFields.js';
import { queryDatasourceTool } from './tools/queryDatasource.js';

class Server extends McpServer {
  readonly name: string;
  readonly version: string;

  constructor() {
    super(
      {
        name: pkg.name,
        version: pkg.version,
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      },
    );

    this.name = pkg.name;
    this.version = pkg.version;
  }
}

export const server = new Server();

const tools = [queryDatasourceTool, listFieldsTool];
for (const { name, description, paramsSchema, callback } of tools) {
  server.tool(name, description, paramsSchema, callback);
}

server.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  setLogLevel(request.params.level);
  return {};
});
