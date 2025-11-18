import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { Tool } from './tools/tool.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';
import { Provider } from './utils/provider.js';

export const serverName = 'tableau-mcp';
export const serverVersion = pkg.version;
export const userAgent = `${serverName}/${serverVersion}`;

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
        },
      },
    );

    this.name = serverName;
    this.version = serverVersion;
  }

  registerTools = async (authInfo?: TableauAuthInfo): Promise<void> => {
    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of this._getToolsToRegister(authInfo)) {
      this.tool(
        name,
        await Provider.from(description),
        await Provider.from(paramsSchema),
        await Provider.from(annotations),
        await Provider.from(callback),
      );
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(this, request.params.level);
      return {};
    });
  };

  private _getToolsToRegister = (authInfo?: TableauAuthInfo): Array<Tool<any>> => {
    const { includeTools, excludeTools } = getConfig();

    const tools = toolFactories.map((toolFactory) => toolFactory(this, authInfo));
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
