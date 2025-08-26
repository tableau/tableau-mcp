import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ElicitRequest,
  ElicitResult,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { Tool } from './tools/tool.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';

export const serverName = pkg.name;
export const serverVersion = pkg.version;

export class Server extends McpServer {
  readonly name: string;
  readonly version: string;

  constructor() {
    super(
      {
        name: serverName,
        version: serverVersion,
      },
      {
        capabilities: {
          logging: {},
          tools: {},
          ...(getConfig().elicitation.disabled ? {} : { elicitation: {} }),
        },
      },
    );

    this.name = serverName;
    this.version = serverVersion;
  }

  registerTools = (): void => {
    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of this._getToolsToRegister()) {
      this.tool(name, description, paramsSchema, annotations, callback);
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(this, request.params.level);
      return {};
    });
  };

  elicitInput = async (
    params: ElicitRequest['params'],
    options?: RequestOptions,
  ): Promise<ElicitResult | 'disabled' | 'unsupported'> => {
    const { elicitation } = getConfig();
    if (elicitation.disabled) {
      return 'disabled';
    }

    if (!this.server.getClientCapabilities()?.elicitation) {
      return 'unsupported';
    }

    return this.server.elicitInput(params, options);
  };

  private _getToolsToRegister = (): Array<Tool<any>> => {
    const { includeTools, excludeTools } = getConfig();

    const tools = toolFactories.map((tool) => tool(this));
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
  };
}

export const exportedForTesting = {
  Server,
};
