import { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { Tool } from './tools/tool.js';
import { ToolName, toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';

export const serverName = pkg.name;
export const serverVersion = pkg.version;

export class Server extends McpServer {
  readonly name: string;
  readonly version: string;
  readonly registeredTools: Map<ToolName, RegisteredTool> = new Map();

  constructor() {
    super(
      {
        name: serverName,
        version: serverVersion,
      },
      {
        capabilities: {
          logging: {},
          tools: {
            listChanged: getConfig().toolRegistrationMode === 'task',
          },
        },
      },
    );

    this.name = serverName;
    this.version = serverVersion;
  }

  registerTools = (
    overrides?: Partial<{
      includeTools: Array<ToolName>;
      excludeTools: Array<ToolName>;
    }>,
  ): void => {
    this.registeredTools.forEach((tool) => tool.remove());
    this.registeredTools.clear();

    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of this._getToolsToRegister(overrides)) {
      const tool = this.tool(name, description, paramsSchema, annotations, callback);
      this.registeredTools.set(name, tool);
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(this, request.params.level);
      return {};
    });
  };

  private _getToolsToRegister = (
    overrides?: Partial<{
      includeTools: Array<ToolName>;
      excludeTools: Array<ToolName>;
    }>,
  ): Array<Tool<any>> => {
    const config = getConfig();
    let { includeTools, excludeTools } = overrides ?? config;
    includeTools = includeTools ?? config.includeTools;
    excludeTools = excludeTools ?? config.excludeTools;

    const tools = toolFactories.map((tool) => tool(this));
    const toolsToRegister = tools.filter((tool) => {
      if (includeTools.length > 0) {
        return includeTools.includes(tool.name);
      }

      if (excludeTools.length > 0) {
        return !excludeTools.includes(tool.name);
      }

      if (tool.name === 'start-task') {
        return false;
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
  };
}

export const exportedForTesting = {
  Server,
};
