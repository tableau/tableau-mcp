import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { ServiceUnavailableError } from './errors/mcpToolError.js';
import { getFeatureGate } from './features/featureGate.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { registerPrompts } from './prompts/index.js';
import { ClientInfo, Server } from './server.js';
import { getTableauAuthInfo } from './server/oauth/getTableauAuthInfo.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { getRequestOverridesFromHeader, X_TABLEAU_MCP_CONFIG_HEADER } from './server/requestUtils';
import { WebTool } from './tools/web/tool.js';
import { TableauWebRequestHandlerExtra } from './tools/web/toolContext.js';
import { webToolNames } from './tools/web/toolName.js';
import { webToolFactories } from './tools/web/tools.js';
import invariant from './utils/invariant.js';
import { getConfigWithOverrides } from './utils/mcpSiteSettings.js';
import { Provider } from './utils/provider.js';

export const serverName = 'tableau-mcp';

const serverVersion = pkg.version;

export class WebMcpServer extends Server {
  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({ mcpServer, clientInfo, serverName, serverVersion });
  }

  registerTools = async (tableauAuthInfo?: TableauAuthInfo): Promise<void> => {
    const config = getConfig();

    const mcpAppsEnabled = getFeatureGate().isFeatureEnabled('mcp-apps');

    for (const tool of await this._getToolsToRegister(tableauAuthInfo)) {
      const toolCallback: ToolCallback<typeof tool.paramsSchema> = async (
        args: typeof tool.paramsSchema,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        if (config.breakGlassDisableGlobally) {
          throw new ServiceUnavailableError(
            'The Tableau MCP server is temporarily unavailable. Please try again later.',
          );
        }

        const requestOverridesHeader =
          extra.requestInfo?.headers[X_TABLEAU_MCP_CONFIG_HEADER]?.toString() ?? '';
        const requestOverrides = getRequestOverridesFromHeader(requestOverridesHeader);
        const tableauToolCallback = await Provider.from(tool.callback);
        const tableauRequestHandlerExtra: TableauWebRequestHandlerExtra = {
          ...extra,
          config,
          server: this,
          get tableauAuthInfo() {
            return getTableauAuthInfo(extra.authInfo);
          },
          _userLuid: undefined,
          _siteLuid: undefined,
          getUserLuid() {
            return (
              tableauRequestHandlerExtra._userLuid ??
              getTableauAuthInfo(extra.authInfo)?.userId ??
              ''
            );
          },
          setUserLuid(userLuid: string) {
            tableauRequestHandlerExtra._userLuid = userLuid;
          },
          getSiteLuid() {
            return (
              tableauRequestHandlerExtra._siteLuid ??
              getTableauAuthInfo(extra.authInfo)?.siteId ??
              ''
            );
          },
          setSiteLuid(siteLuid: string) {
            tableauRequestHandlerExtra._siteLuid = siteLuid;
          },
          getConfigWithOverrides: async () =>
            getConfigWithOverrides({ restApiArgs: tableauRequestHandlerExtra, requestOverrides }),
        };

        return tableauToolCallback(args, tableauRequestHandlerExtra);
      };

      if (mcpAppsEnabled && tool.app) {
        await this._registerAppTool(tool, toolCallback);
      } else {
        await this._registerTool(tool, toolCallback);
      }
    }

    registerPrompts(this);
  };

  protected _getToolsToRegister = async (
    tableauAuthInfo?: TableauAuthInfo,
  ): Promise<Array<WebTool<any>>> => {
    const config = getConfig();
    const configOverrides = await getConfigWithOverrides({
      restApiArgs: {
        server: this,
        tableauAuthInfo,
        disableLogging: true, // MCP server is not connected yet so we can't send logging notifications
      },
      requestOverrides: {}, // request overrides are not relevant when getting tools
    });

    const tableauServerInfo = await getTableauServerInfo(config.server || tableauAuthInfo?.server);

    const { includeTools, excludeTools } = configOverrides;

    const allTools = webToolFactories.map((toolFactory) =>
      toolFactory(this, tableauServerInfo.productVersion),
    );
    const toolsToRegister: typeof allTools = [];
    for (const tool of allTools) {
      if (await Provider.from(tool.disabled)) continue;
      if (includeTools.length > 0 && !includeTools.includes(tool.name)) continue;
      if (excludeTools.length > 0 && excludeTools.includes(tool.name)) continue;
      toolsToRegister.push(tool);
    }

    if (toolsToRegister.length === 0) {
      throw new Error(`
          No tools to register.
          Tools available = [${webToolNames.join(', ')}].
          EXCLUDE_TOOLS = [${excludeTools.join(', ')}].
          INCLUDE_TOOLS = [${includeTools.join(', ')}]
        `);
    }

    return toolsToRegister;
  };

  private _registerTool = async (
    tool: WebTool<any>,
    toolCallback: ToolCallback<typeof tool.paramsSchema>,
  ): Promise<void> => {
    this.mcpServer.registerTool(
      tool.name,
      {
        title: await Provider.from(tool.title),
        description: await Provider.from(tool.description),
        inputSchema: await Provider.from(tool.paramsSchema),
        annotations: await Provider.from(tool.annotations),
      },
      toolCallback,
    );
  };

  private _registerAppTool = async (
    tool: WebTool<any>,
    toolCallback: ToolCallback<typeof tool.paramsSchema>,
  ): Promise<void> => {
    invariant(tool.app, `Tool ${tool.name} is an app but no app details were provided`);

    const { resourceUri, html } = tool.app;

    // Register a tool with UI metadata. When the host calls this tool, it reads
    // `_meta.ui.resourceUri` to know which resource to fetch and render as an
    // interactive UI.
    registerAppTool(
      this.mcpServer,
      tool.name,
      {
        title: (await Provider.from(tool.annotations)).title,
        description: await Provider.from(tool.description),
        inputSchema: await Provider.from(tool.paramsSchema),
        annotations: await Provider.from(tool.annotations),
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
      this.mcpServer,
      tool.name,
      resourceUri,
      { mimeType: RESOURCE_MIME_TYPE },
      async () => {
        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: html,
            },
          ],
        };
      },
    );
  };
}
