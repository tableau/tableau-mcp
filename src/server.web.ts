import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { ServiceUnavailableError } from './errors/mcpToolError.js';
import { getFeatureGate } from './features/init.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { registerPrompts } from './prompts/index.js';
import { ClientInfo, Server } from './server.js';
import {
  ClientCapabilitiesWithUiExtension,
  clientSupportsMcpApps,
} from './server/mcpUiCapability.js';
import { getTableauAuthInfo } from './server/oauth/getTableauAuthInfo.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { getRequestOverridesFromHeader, X_TABLEAU_MCP_CONFIG_HEADER } from './server/requestUtils';
import { getClientDisplayName } from './telemetry/clientDisplayName.js';
import { WebTool } from './tools/web/tool.js';
import { TableauWebRequestHandlerExtra } from './tools/web/toolContext.js';
import { webToolFactories } from './tools/web/tools.js';
import { getDirname } from './utils/getDirname.js';
import invariant from './utils/invariant.js';
import { getConfigWithOverrides } from './utils/mcpSiteSettings.js';
import { Provider } from './utils/provider.js';

export const serverName = 'tableau-mcp';

const serverVersion = pkg.version;
const __dirname = getDirname();

const BASE_INSTRUCTIONS =
  'Tableau MCP exposes tools for exploring and querying Tableau Cloud/Server content: ' +
  'datasources, workbooks, views, Pulse metrics, and content search.';

// Admin/site-health guidance. Advertised only when ADMIN_TOOLS_ENABLED is set (config.adminToolsEnabled).
// This is safe with no role lookup: the per-call assertAdmin gate still rejects any non-admin at execution,
// so listing the capability menu leaks nothing. Tied to GENERIC admin-health intent so a generic prompt
// (e.g. "what should I watch as an admin?") elicits these instead of only by-name requests.
const ADMIN_INSTRUCTIONS =
  'This server also has site-administration capabilities. For general admin/site-health, governance, ' +
  'cleanup, or cost/license questions, proactively consider the admin prompts (stale-content cleanup, ' +
  'job/extract optimization, user-license reclamation) and the query-admin-insights tool ' +
  '(e.g. stale-content, job-performance, ts-users) for supporting data — even when the user asks broadly ' +
  'rather than naming a specific tool. ' +
  'Do not require the user to state or re-confirm admin status before using these tools — invoke them ' +
  'whenever the task warrants; the server authorizes each call and cleanly rejects non-admins. ' +
  'When rendering admin/list results (users, admin-insights, etc.) to a chat or Slack surface, present ' +
  'them as Markdown tables.';

/**
 * Single source of truth for the web server's `initialize` instructions string. Returns the base
 * guidance, with the admin/site-health guidance appended only when ADMIN_TOOLS_ENABLED is set.
 *
 * ADMIN_TOOLS_ENABLED is read straight from env (matching Config's exact semantics in config.ts:
 * `ADMIN_TOOLS_ENABLED === 'true'`) rather than via getConfig(). The instructions string depends
 * ONLY on this flag, and it is composed at handshake/registration-independent construction time —
 * eagerly building the full Config here would newly require SERVER to be set and would consume test
 * getConfig() mocks. Direct env read keeps composition side-effect-free.
 *
 * Both the default/web path (WebMcpServer constructs its own McpServer) and the combined path
 * (index.combined.ts supplies a pre-built McpServer) MUST feed instructions through this function.
 * The SDK reads `instructions` only from the McpServer constructor options (it is never settable
 * post-construction), so a supplied McpServer that was not built with these instructions would
 * silently drop them — see the guard in server.ts.
 */
export function buildWebInstructions(): string {
  const adminToolsEnabled = process.env.ADMIN_TOOLS_ENABLED === 'true';
  return adminToolsEnabled ? `${BASE_INSTRUCTIONS} ${ADMIN_INSTRUCTIONS}` : BASE_INSTRUCTIONS;
}

export class WebMcpServer extends Server {
  constructor({
    mcpServer,
    clientInfo,
    capabilities,
    clientId,
  }: {
    mcpServer?: McpServer;
    clientInfo?: ClientInfo;
    capabilities?: ClientCapabilitiesWithUiExtension;
    clientId?: string;
  } = {}) {
    super({
      mcpServer,
      clientInfo,
      capabilities,
      clientId,
      serverName,
      serverVersion,
      instructions: buildWebInstructions(),
    });
  }

  registerTools = async (tableauAuthInfo?: TableauAuthInfo): Promise<void> => {
    const config = getConfig();

    const mcpAppsEnabled = await getFeatureGate().isFeatureEnabled('mcp-apps');

    // App tools are only rendered by clients that advertise the SEP-1724 UI capability during the
    // `initialize` handshake; default to the plain-tool fallback when support is unknown/absent.
    const supportsMcpApps = clientSupportsMcpApps(this.capabilities);

    // claude.ai over OAuth/HTTP advertises the UI capability but its MCP-Apps renderer is broken,
    // so force the plain-tool fallback for it regardless of what it declares. Reuses the existing
    // telemetry client_id → display-name mapping; undefined clientId (e.g. stdio) is never 'Claude'.
    const isKnownIncompatibleClient = getClientDisplayName(this.clientId) === 'Claude';

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
          getSiteName() {
            return getTableauAuthInfo(extra.authInfo)?.siteName ?? config.siteName;
          },
          getConfigWithOverrides: async () =>
            getConfigWithOverrides({ restApiArgs: tableauRequestHandlerExtra, requestOverrides }),
        };

        return tableauToolCallback(args, tableauRequestHandlerExtra);
      };

      if (mcpAppsEnabled && tool.app && supportsMcpApps && !isKnownIncompatibleClient) {
        await this._registerAppTool(tool, toolCallback);
      } else if (tool.app?.hideWhenUnsupported) {
        continue;
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

    const allTools = await Promise.all(
      webToolFactories.map((toolFactory) => toolFactory(this, tableauServerInfo.productVersion)),
    );
    const toolsToRegister: typeof allTools = [];
    for (const tool of allTools) {
      if (await Provider.from(tool.disabled)) continue;
      if (includeTools.length > 0 && !includeTools.includes(tool.name)) continue;
      if (excludeTools.length > 0 && excludeTools.includes(tool.name)) continue;
      toolsToRegister.push(tool);
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
        _meta: await Provider.from(tool.meta),
      },
      toolCallback,
    );
  };

  private _registerAppTool = async (
    tool: WebTool<any>,
    toolCallback: ToolCallback<typeof tool.paramsSchema>,
  ): Promise<void> => {
    invariant(tool.app, `Tool ${tool.name} is an app but no app details were provided`);

    const { resourceUri, htmlPath } = tool.app;

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
    const config = getConfig();

    // Allow configured CSP domains
    const cspDomains = config.cspAllowedDomains;

    registerAppResource(
      // @ts-expect-error -- harmless type mismatch in registerAppResource; ext-apps uses MCP SDK v1.25.2. Should go away when MCP SDK is updated.
      this.mcpServer,
      tool.name,
      resourceUri,
      {
        mimeType: RESOURCE_MIME_TYPE,
      },
      async (): Promise<ReadResourceResult> => {
        const htmlContent = await readFile(join(__dirname, htmlPath), 'utf-8');

        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: htmlContent,
              _meta: {
                ui: {
                  csp: {
                    connectDomains: cspDomains,
                    resourceDomains: cspDomains,
                    frameDomains: cspDomains,
                  },
                },
              },
            },
          ],
        };
      },
    );
  };
}
