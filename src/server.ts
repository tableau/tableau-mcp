import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { Tool } from './tools/tool.js';
import { toolNames } from './tools/toolName.js';
import { tools } from './tools/tools.js';

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

  registerTools = (): void => {
    for (const { name, description, paramsSchema, annotations, callback } of getToolsToRegister()) {
      this.tool(name, description, paramsSchema, annotations, callback);
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(request.params.level);
      return {};
    });
  };
}

export const server = new Server();

function getToolsToRegister(): Array<Tool<any>> {
  const { includeTools, excludeTools } = getConfig();
  const toolsToRegister = tools.filter((tool) => {
    if (includeTools.length > 0) {
      return includeTools.includes(tool.name);
    }

    if (excludeTools.length > 0) {
      return !excludeTools.includes(tool.name);
    }

    return true;
  });

  if (toolsToRegister.length === 0) {
    throw new Error(`
        No tools to register.
        Tools available = [${toolNames.join(', ')}].
        EXCLUDE_TOOLS = [${excludeTools.join(', ')}].
        INCLUDE_TOOLS = [${includeTools.join(', ')}]
      `);
  }

  return toolsToRegister;
}

export const exportedForTesting = {
  Server,
};
