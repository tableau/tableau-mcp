import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  InitializeRequest,
  RequestId,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json';
import { setLogLevel } from './logging/log.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { Tool } from './tools/tool.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';
import { getConfigWithOverrides } from './utils/mcpSiteSettings';
import { Provider } from './utils/provider.js';

export const serverName = 'tableau-mcp';
export const serverVersion = pkg.version;
export const userAgent = `${serverName}/${serverVersion}`;

export type ClientInfo = InitializeRequest['params']['clientInfo'];

export class Server extends McpServer {
  readonly name: string;
  readonly version: string;

  // Note that the McpServer class does expose a (poorly named) "getClientVersion()" method that returns the client info,
  // but the value of the field it returns is only set during the initialization lifecycle request.
  //
  // With HTTP transport, we create a new instance of the Server class for *each* request, so we store the client info
  // provided by the client in its initialization lifecycle request in the session store,
  // and pass it to the constructor with each post-initialization request.
  //
  // With stdio transport, we can use the getClientVersion() method to get the client info.
  private readonly _clientInfo: ClientInfo | undefined;

  get clientInfo(): ClientInfo | undefined {
    return this._clientInfo ?? this.server.getClientVersion();
  }

  constructor({ clientInfo }: { clientInfo?: ClientInfo } = {}) {
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
    this._clientInfo = clientInfo;
  }

  registerTools = async (requestId?: RequestId, authInfo?: TableauAuthInfo): Promise<void> => {
    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of await this._getToolsToRegister(requestId ?? 'no-request-id', authInfo)) {
      this.registerTool(
        name,
        {
          description: await Provider.from(description),
          inputSchema: await Provider.from(paramsSchema),
          annotations: await Provider.from(annotations),
        },
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

  private _getToolsToRegister = async (
    requestId: RequestId,
    authInfo?: TableauAuthInfo,
  ): Promise<Array<Tool<any>>> => {
    const config = await getConfigWithOverrides({
      restApiArgs: {
        requestId,
        server: this,
        authInfo,
        disableLogging: true, // MCP server is not connected yet so we can't send logging notifications
      },
    });

    const { includeTools, excludeTools } = config;

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
