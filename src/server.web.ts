import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from './config.js';
import { getTableauServerInfo } from './getTableauServerInfo';
import { Server } from './server';
import { getTableauAuthInfo } from './server/oauth/getTableauAuthInfo';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { WebTool } from './tools/tool.web.js';
import { TableauWebRequestHandlerExtra } from './tools/toolContext.web.js';
import { webToolNames } from './tools/toolName.web';
import { toolFactories } from './tools/tools';
import { getConfigWithOverrides } from './utils/mcpSiteSettings';
import { Provider } from './utils/provider.js';

export class WebMcpServer extends Server {
  registerTools = async (tableauAuthInfo?: TableauAuthInfo): Promise<void> => {
    const config = getConfig();

    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of await this._getToolsToRegister(tableauAuthInfo)) {
      const toolCallback: ToolCallback<typeof paramsSchema> = async (
        args: typeof paramsSchema,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const tableauToolCallback = await Provider.from(callback);
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
            getConfigWithOverrides({ restApiArgs: tableauRequestHandlerExtra }),
        };

        return tableauToolCallback(args, tableauRequestHandlerExtra);
      };

      this.mcpServer.registerTool(
        name,
        {
          description: await Provider.from(description),
          inputSchema: await Provider.from(paramsSchema),
          annotations: await Provider.from(annotations),
        },
        toolCallback,
      );
    }
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
    });

    const tableauServerInfo = await getTableauServerInfo(config.server || tableauAuthInfo?.server);

    const { includeTools, excludeTools } = configOverrides;

    const allTools = toolFactories.map((toolFactory) =>
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
}
