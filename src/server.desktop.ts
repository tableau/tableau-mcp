import { McpServer, ResourceTemplate, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ErrorCode,
  McpError,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json';
import { getDesktopConfig } from './config.desktop.js';
import { DATA_ROOT, readResourceAsset, RESOURCES_ROOT } from './desktop/assets.js';
import { listKnowledgeResources, readKnowledgeResource } from './desktop/knowledge/index.js';
import { SessionManager } from './desktop/sessionManager.js';
import { ClientInfo, Server } from './server.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { TableauDesktopRequestHandlerExtra } from './tools/desktop/toolContext.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

const serverName = 'tableau-desktop-mcp';
const serverVersion = pkg.version;

export { DATA_ROOT, RESOURCES_ROOT };

export class DesktopMcpServer extends Server {
  private readonly sessionManager = new SessionManager();

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({ mcpServer, clientInfo, serverName, serverVersion });
  }

  registerResources = async (): Promise<void> => {
    await this._registerDashboardXmlGuide();
    this._registerKnowledgeResources();
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

  private _registerKnowledgeResources = (): void => {
    const template = new ResourceTemplate('expertise://tableau/{+slug}', {
      list: () => ({
        resources: listKnowledgeResources().map(({ uri, name, description, mimeType }) => ({
          uri,
          name,
          description,
          mimeType,
        })),
      }),
    });

    this.registerResource({
      name: 'tableau-expertise-knowledge',
      title: 'Tableau authoring knowledge',
      description: 'Expertise modules scanned from resources/desktop/knowledge',
      template,
      readTemplateCallback: (uri, variables) => {
        const slug = variables['slug'];
        if (typeof slug !== 'string' || !slug) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing expertise slug in URI.');
        }
        const text = readKnowledgeResource(`expertise://tableau/${slug}`);
        if (!text) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unknown knowledge resource: expertise://tableau/${slug}`,
          );
        }
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
      },
    });
  };

  private _registerDashboardXmlGuide = async (): Promise<void> => {
    const text = readResourceAsset('dashboard-xml-guide.md');
    if (text === null) {
      throw new McpError(
        ErrorCode.InternalError,
        'Dashboard XML guide asset not found: dashboard-xml-guide.md',
      );
    }
    this.registerResource({
      name: 'dashboard-xml-guide',
      uri: 'tableau://docs/dashboard-xml-guide',
      title: 'Dashboard XML manipulation guide',
      description: 'Zone positioning, layouts, best practices for dashboard XML editing',
      text,
      mimeType: 'text/markdown',
    });
  };
}
