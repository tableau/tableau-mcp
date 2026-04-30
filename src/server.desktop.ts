import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { join } from 'path';

import pkg from '../package.json';
import { getDesktopConfig } from './config.desktop.js';
import { SessionManager } from './desktop/sessionManager.js';
import { ClientInfo, Server } from './server.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { TableauDesktopRequestHandlerExtra } from './tools/desktop/toolContext.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { getDirname } from './utils/getDirname';
import { Provider } from './utils/provider.js';

const serverName = 'tableau-desktop-mcp';
const serverVersion = pkg.version;

const RESOURCE_ROOTS = [
  join(getDirname(), 'resources', 'desktop'),
  join(getDirname(), '..', 'resources', 'desktop'),
];

const RESOURCES_ROOT = RESOURCE_ROOTS.find(existsSync) ?? RESOURCE_ROOTS[0];

export class DesktopMcpServer extends Server {
  private readonly sessionManager = new SessionManager();

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({ mcpServer, clientInfo, serverName, serverVersion });
  }

  registerResources = async (): Promise<void> => {
    await this._registerDashboardXmlGuide();
  };

  registerTools = async (): Promise<void> => {
    const config = getDesktopConfig();

    for (const {
      name,
      title,
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
          getExecutor: async (sessionId: string) => {
            return await this.sessionManager.getExecutor(sessionId);
          },
          server: this,
        };

        return tableauToolCallback(args, tableauRequestHandlerExtra);
      };

      this.mcpServer.registerTool(
        name,
        {
          title: await Provider.from(title),
          description: await Provider.from(description),
          inputSchema: await Provider.from(paramsSchema),
          annotations: await Provider.from(annotations),
        },
        toolCallback,
      );
    }
  };

  protected _getToolsToRegister = async (): Promise<Array<DesktopTool<any>>> => {
    const allTools = desktopToolFactories.map((toolFactory) => toolFactory(this));
    return allTools;
  };

  private _registerDashboardXmlGuide = async (): Promise<void> => {
    this.registerResource({
      name: 'dashboard-xml-guide',
      uri: 'tableau://docs/dashboard-xml-guide',
      title: 'Dashboard XML manipulation guide',
      description: 'Zone positioning, layouts, best practices for dashboard XML editing',
      path: join(RESOURCES_ROOT, 'dashboard-xml-guide.md'),
      mimeType: 'text/markdown',
    });
  };
}
