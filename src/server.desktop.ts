import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ServerNotification,
  ServerRequest,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from './config.js';
import { setNotificationLevel } from './logging/notification.js';
import { Server } from './server';
import { DesktopTool } from './tools/tool.desktop.js';
import { TableauDesktopRequestHandlerExtra } from './tools/toolContext.desktop.js';
import { toolFactories } from './tools/tools.desktop.js';
import { Provider } from './utils/provider.js';

export class DesktopMcpServer extends Server {
  registerTools = async (): Promise<void> => {
    const config = getConfig();

    for (const {
      name,
      description,
      paramsSchema,
      annotations,
      callback,
    } of await this._getToolsToRegister()) {
      const toolCallback: ToolCallback<typeof paramsSchema> = async (
        args: typeof paramsSchema,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const tableauToolCallback = await Provider.from(callback);
        const tableauRequestHandlerExtra: TableauDesktopRequestHandlerExtra = {
          ...extra,
          config,
          server: this,
        };

        return tableauToolCallback(args, tableauRequestHandlerExtra);
      };

      this.registerTool(
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

  registerRequestHandlers = (): void => {
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setNotificationLevel(this, request.params.level);
      return {};
    });
  };

  protected _getToolsToRegister = async (): Promise<Array<DesktopTool<any>>> => {
    const allTools = toolFactories.map((toolFactory) => toolFactory(this));
    return allTools;
  };
}
