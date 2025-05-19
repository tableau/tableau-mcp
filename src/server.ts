import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { listFieldsTool } from './tools/listFields.js';
import { queryDatasourceTool } from './tools/queryDatasource.js';
import { toolNames } from './tools/toolName.js';

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

const { includeTools, excludeTools } = getConfig();
const tools = [queryDatasourceTool, listFieldsTool].filter((tool) => {
  if (includeTools.length > 0) {
    return includeTools.includes(tool.name);
  }

  if (excludeTools.length > 0) {
    return !excludeTools.includes(tool.name);
  }

  return true;
});

if (tools.length === 0) {
  throw new Error(`
      No tools to register.
      Tools available: [${toolNames.join(', ')}].
      EXCLUDE_TOOLS = [${excludeTools.join(', ')}].
      INCLUDE_TOOLS = [${includeTools.join(', ')}]
    `);
}

for (const { name, description, paramsSchema, callback } of tools) {
  server.tool(name, description, paramsSchema, callback);
}

server.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  setLogLevel(request.params.level);
  return {};
});
