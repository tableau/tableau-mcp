import { McpServer, ResourceTemplate, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ErrorCode,
  McpError,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { join } from 'path';

import pkg from '../package.json';
import { getDesktopConfig } from './config.desktop.js';
import { listKnowledgeResources, readKnowledgeResource } from './desktop/knowledge/index.js';
import { SessionManager } from './desktop/sessionManager.js';
import { log } from './logging/logger.js';
import { ClientInfo, Server } from './server.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { TableauDesktopRequestHandlerExtra } from './tools/desktop/toolContext.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { getDirname } from './utils/getDirname';
import { Provider } from './utils/provider.js';

const serverName = 'tableau-desktop-mcp';
const serverVersion = pkg.version;

const DATA_ROOTS = [
  join(getDirname(), 'desktop', 'data'),
  join(getDirname(), '..', 'src', 'desktop', 'data'),
];
const RESOURCE_ROOTS = [
  join(getDirname(), 'resources', 'desktop'),
  join(getDirname(), '..', 'resources', 'desktop'),
];

export const DATA_ROOT = DATA_ROOTS.find(existsSync) ?? DATA_ROOTS[0];
export const RESOURCES_ROOT = RESOURCE_ROOTS.find(existsSync) ?? RESOURCE_ROOTS[0];

// Routing guidance every connecting client receives at initialize (W60 adoption P5 —
// the demo build previously shipped NO instructions, so skill-less clients got zero
// routing and the template fast path stayed dark in real sessions).
const DESKTOP_INSTRUCTIONS = `You are controlling Tableau Desktop.

For a plain chart ask (bar, column, line, treemap, waterfall, scatter, filled map, KPI, funnel, box plot), FIRST call bind-template with the user's ask and auto_apply: true — a confident bind renders the chart in ONE call (~2s server-side, no further tool calls). On propose/escalate, fall back to the general authoring tools (get-workbook-xml -> edit -> apply-workbook, or inject-template for a known template).

Every session-scoped tool call needs the session id from list-instances — except bind-template, which auto-resolves the session when exactly one Desktop instance is running.

If an apply is rejected by preflight validation, fix the XML per the FIX lines in the error and re-apply. Prefer file mode for large workbooks.`;

export class DesktopMcpServer extends Server {
  private readonly sessionManager = new SessionManager();

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({ mcpServer, clientInfo, serverName, serverVersion, instructions: DESKTOP_INSTRUCTIONS });
  }

  registerResources = async (): Promise<void> => {
    await this._registerDashboardXmlGuide();
    this._registerKnowledgeResources();
  };

  registerTools = async (): Promise<void> => {
    const config = getDesktopConfig();

    log({
      message: config.externalApiEnabled
        ? 'Desktop transport ACTIVE: External Client API (Athena V0) — TABLEAU_EXTERNAL_API enabled'
        : 'Desktop transport ACTIVE: Agent API (default)',
      level: 'info',
      logger: 'DesktopMcpServer',
      data: { externalApiEnabled: config.externalApiEnabled },
    });

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
