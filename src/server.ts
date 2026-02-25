import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  InitializeRequest,
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { setLogLevel } from './logging/log.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { Tool } from './tools/tool.js';
import { TableauRequestHandlerExtra } from './tools/toolContext.js';
import { toolNames } from './tools/toolName.js';
import { toolFactories } from './tools/tools.js';
import invariant from './utils/invariant';
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

  registerTools = async (tableauAuthInfo?: TableauAuthInfo): Promise<void> => {
    const config = getConfig();

    for (const tool of await this._getToolsToRegister(tableauAuthInfo)) {
      const toolCallback: ToolCallback<typeof tool.paramsSchema> = async (
        args: typeof tool.paramsSchema,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const tableauToolCallback = await Provider.from(tool.callback);
        const tableauRequestHandlerExtra: TableauRequestHandlerExtra = {
          ...extra,
          config,
          server: this,
          tableauAuthInfo,
          getConfigWithOverrides: async () =>
            getConfigWithOverrides({ restApiArgs: tableauRequestHandlerExtra }),
        };

        return tableauToolCallback(args, tableauRequestHandlerExtra);
      };

      if (tool.app) {
        await this._registerAppTool(tool, toolCallback);
      } else {
        await this._registerTool(tool, toolCallback);
      }
    }
  };

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setLogLevel(this, request.params.level);
      return {};
    });
  };

  private _getToolsToRegister = async (
    tableauAuthInfo?: TableauAuthInfo,
  ): Promise<Array<Tool<any>>> => {
    const config = await getConfigWithOverrides({
      restApiArgs: {
        server: this,
        tableauAuthInfo,
        disableLogging: true, // MCP server is not connected yet so we can't send logging notifications
      },
    });

    const { includeTools, excludeTools } = config;

    const tools = toolFactories.map((toolFactory) => toolFactory(this, tableauAuthInfo));
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

  private _registerTool = async (
    { name, description, paramsSchema, annotations }: Tool<any>,
    toolCallback: ToolCallback<typeof paramsSchema>,
  ): Promise<void> => {
    this.registerTool(
      name,
      {
        description: await Provider.from(description),
        inputSchema: await Provider.from(paramsSchema),
        annotations: await Provider.from(annotations),
      },
      toolCallback,
    );
  };

  private _registerAppTool = async (
    { name, description, paramsSchema, annotations, app }: Tool<any>,
    toolCallback: ToolCallback<typeof paramsSchema>,
  ): Promise<void> => {
    invariant(app, `Tool ${name} is an app but no app details were provided`);

    // Two-part registration: tool + resource, tied together by the resource URI.
    // Register a tool with UI metadata. When the host calls this tool, it reads
    // `_meta.ui.resourceUri` to know which resource to fetch and render as an
    // interactive UI.
    const { resourceUri, html, sandboxCapabilities } = app;
    registerAppTool(
      this,
      name,
      {
        title: (await Provider.from(annotations)).title,
        description: await Provider.from(description),
        inputSchema: await Provider.from(paramsSchema),
        annotations: await Provider.from(annotations),
        _meta: {
          ui: {
            resourceUri,
          },
        },
      },
      toolCallback,
    );

    // Register the resource, which returns the bundled HTML/JavaScript for the UI.
    registerAppResource(
      // @ts-expect-error -- harmless type mismatch in registerAppResource; ext-apps uses MCP SDK v1.25.2. Should go away when MCP SDK is updated.
      this,
      resourceUri,
      resourceUri,
      { mimeType: RESOURCE_MIME_TYPE },
      async (): Promise<ReadResourceResult> => {
        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
              _meta: { ui: { ...sandboxCapabilities } },
            },
          ],
        };
      },
    );
  };
}

export const exportedForTesting = {
  Server,
};
