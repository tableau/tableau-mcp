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
import { log } from './logging/logger.js';
import { ClientInfo, Server } from './server.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { TableauDesktopRequestHandlerExtra } from './tools/desktop/toolContext.js';
import { DesktopToolName } from './tools/desktop/toolName.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

const serverName = 'tableau-desktop-mcp';
const serverVersion = pkg.version;

/**
 * Slim demo tool set (W60 spike lever 1 / preamble-hunt P1): registering ~10 tools instead
 * of the full 42 shrinks the serialized schema surface (~15-25k → ~4-5k tokens), which the
 * preamble-hunt measured as the single biggest per-turn latency win (−4.5 to −5.5s/chart)
 * and a per-turn token/cost reduction. Reconciled from BOTH source lists: the spike's
 * fast-path/coordination tools (bind-template, list-instances, list-available-fields,
 * list-worksheets, apply-workbook, batch-create-and-cache-sheets, build-and-apply-dashboard)
 * UNION the preamble-hunt's escalation-fallback chain it insists must stay
 * (get-workbook-xml, inject-template, apply-worksheet — apply-workbook/list-instances/
 * list-worksheets already overlap). Without the fallback chain the propose/escalate paths
 * (per DESKTOP_INSTRUCTIONS) would have no tools to route to.
 */
export const DEMO_TOOL_PROFILE: ReadonlySet<DesktopToolName> = new Set<DesktopToolName>([
  'bind-template',
  'dashboard-auto-apply',
  'list-instances',
  'list-worksheets',
  'list-available-fields',
  'apply-workbook',
  'get-workbook-xml',
  'inject-template',
  'apply-worksheet',
  'batch-create-and-cache-sheets',
  'build-and-apply-dashboard',
]);

/**
 * Select the tools to register for a given TOOL_PROFILE value (already normalized by
 * Config: trim + lowercase). 'demo' → the slim {@link DEMO_TOOL_PROFILE} subset; '' (unset)
 * or 'full' → the full set unchanged (same array reference — byte-identical behavior); any
 * other value → full set + a logged warning. Pure and side-effect-free apart from the
 * warning log, so the selection can be unit-tested without the server or env.
 */
export function selectToolsForProfile<T extends { name: DesktopToolName }>(
  tools: T[],
  profile: string,
): T[] {
  if (profile === 'demo') {
    return tools.filter((tool) => DEMO_TOOL_PROFILE.has(tool.name));
  }
  if (profile !== '' && profile !== 'full') {
    log({
      message: `Unknown TOOL_PROFILE "${profile}" — registering the full tool set.`,
      level: 'warning',
      logger: 'DesktopMcpServer',
    });
  }
  return tools;
}

export { DATA_ROOT, RESOURCES_ROOT };

// Routing guidance every connecting client receives at initialize (W60 adoption P5 —
// the demo build previously shipped NO instructions, so skill-less clients got zero
// routing and the template fast path stayed dark in real sessions).
const DESKTOP_INSTRUCTIONS = `You are controlling Tableau Desktop.

For a plain chart ask (bar, column, line, treemap, waterfall, scatter, filled map, KPI, funnel, box plot), FIRST call bind-template with the user's ask and auto_apply: true — a confident bind renders the chart in ONE call (~2s server-side, no further tool calls). On propose/escalate, fall back to the general authoring tools (get-workbook-xml -> edit -> apply-workbook, or inject-template for a known template).

For a dashboard ask with 2-6 charts (e.g. "a dashboard with sales by region and profit by category"), FIRST call dashboard-auto-apply with one { ask, title? } per chart and a dashboardName — it binds and composes every chart into one dashboard in ONE call. If any ask fails to deterministically bind, nothing is applied and each ask's outcome is returned; fall back to bind-template per chart, or build-and-apply-dashboard for KPI strips / custom zone layouts.

Every session-scoped tool call needs the session id from list-instances — except bind-template and dashboard-auto-apply, which auto-resolve the session when exactly one Desktop instance is running.

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
    return selectToolsForProfile(allTools, getDesktopConfig().toolProfile);
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
