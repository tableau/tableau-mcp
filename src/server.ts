import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json' with { type: 'json' };
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { Tool } from './tools/tool.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';

export const serverName = 'tableau-mcp';
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
        },
      },
    );

    this.name = serverName;
    this.version = serverVersion;
  }

  registerTools = async ({ tableauServer }: { tableauServer: string }): Promise<void> => {
    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of await this._getToolsToRegister(tableauServer)) {
      this.tool(name, description, paramsSchema, annotations, callback);
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(this, request.params.level);
      return {};
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- remove this eslint comment once a tool exists whose behavior depends on the Tableau server version
  private _getToolsToRegister = async (tableauServer: string): Promise<Array<Tool<any>>> => {
    const { includeTools, excludeTools } = getConfig();

    // TODO: Once a tool exists whose behavior depends on the Tableau server version,
    // we should get the product version here.
    // const productVersion = await getTableauServerVersion(tableauServer);

    const tools = toolFactories.map((tool) => tool(this /*,  productVersion */));
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
