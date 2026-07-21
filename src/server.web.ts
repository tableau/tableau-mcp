import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolResult,
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';

import pkg from '../package.json';
import { getConfig } from './config.js';
import { ServiceUnavailableError } from './errors/mcpToolError.js';
import { getFeatureGate } from './features/init.js';
import { getTableauServerInfo } from './getTableauServerInfo.js';
import { registerPrompts } from './prompts/index.js';
import { ClientInfo, Server } from './server.js';
import { getTableauAuthInfo } from './server/oauth/getTableauAuthInfo.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { getRequestOverridesFromHeader, X_TABLEAU_MCP_CONFIG_HEADER } from './server/requestUtils';
import { WebTool } from './tools/web/tool.js';
import { TableauWebRequestHandlerExtra } from './tools/web/toolContext.js';
import {
  WebToolGroupName,
  webToolGroupNames,
  webToolGroups,
  WebToolName,
} from './tools/web/toolName.js';
import { webToolFactories } from './tools/web/tools.js';
import { getDirname } from './utils/getDirname.js';
import invariant from './utils/invariant.js';
import { getConfigWithOverrides } from './utils/mcpSiteSettings.js';
import { Provider } from './utils/provider.js';

export const serverName = 'tableau-mcp';

const serverVersion = pkg.version;
const __dirname = getDirname();

// Lazy web-tool loading (combined-lean profile): the combined desktop+web surface
// serializes ~3x past the ~46k-byte tools/list cliff where clients auto-defer schemas,
// and even dropping the whole pulse group leaves it far over. So under
// TOOL_PROFILE=combined-lean the web half advertises ONE tiny loader tool; calling it
// registers the requested group's real tools on the live server (the SDK emits
// notifications/tools/list_changed on each registration).
export const LOAD_WEB_TOOLS_TOOL_NAME = 'load-web-tools';
const loadableWebToolGroupNames = [...webToolGroupNames, 'all'] as const;
export type LoadableWebToolGroupName = (typeof loadableWebToolGroupNames)[number];
const loadWebToolsParamsSchema = {
  group: z.enum(loadableWebToolGroupNames),
};

export type LoadWebToolsResult = {
  status: 'loaded' | 'already-loaded';
  toolNames: WebToolName[];
};

export class WebMcpServer extends Server {
  private readonly _loadedLazyWebToolGroups = new Set<WebToolGroupName>();
  private readonly _registeredLazyWebToolNames = new Set<WebToolName>();

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({ mcpServer, clientInfo, serverName, serverVersion });
  }

  registerResources = async (): Promise<void> => {
    // No resources to register
  };

  registerTools = async (tableauAuthInfo?: TableauAuthInfo): Promise<void> => {
    const config = getConfig();

    // Lazy loading is meaningless on stateless HTTP: the per-request server is
    // discarded as the response closes, so tools hydrated by the loader would
    // register on a corpse. Fall back to the eager surface there.
    const statelessHttp = config.transport === 'http' && config.disableSessionManagement;
    if (config.toolProfile === 'combined-lean' && !statelessHttp) {
      this._registerLoadWebToolsTool();
    } else {
      for (const tool of await this._getToolsToRegister(tableauAuthInfo)) {
        await this._registerWebTool(tool);
      }
    }

    registerPrompts(this);
  };

  /**
   * Register a web tool group's real tools on the live server (combined-lean lazy path).
   * Idempotent: already-registered tools are skipped (the SDK throws on duplicate names).
   * Registration goes through the same filtered pipeline as eager startup, so disabled
   * tools and INCLUDE_TOOLS/EXCLUDE_TOOLS scoping still apply.
   */
  loadWebTools = (
    group: LoadableWebToolGroupName,
    tableauAuthInfo?: TableauAuthInfo,
  ): Promise<LoadWebToolsResult> => {
    // Serialize loads: two overlapping calls for the same group would both pass
    // the loaded-set check and the second registerTool would throw on the
    // duplicate name. The chain never rejects (failures are surfaced on the
    // caller's promise, swallowed on the chain) so one bad load can't wedge it.
    const run = this._loadWebToolsChain.then(() => this._loadWebToolsInner(group, tableauAuthInfo));
    this._loadWebToolsChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  private _loadWebToolsChain: Promise<void> = Promise.resolve();

  private _loadWebToolsInner = async (
    group: LoadableWebToolGroupName,
    tableauAuthInfo?: TableauAuthInfo,
  ): Promise<LoadWebToolsResult> => {
    const groupNames: readonly WebToolGroupName[] = group === 'all' ? webToolGroupNames : [group];

    if (groupNames.every((groupName) => this._loadedLazyWebToolGroups.has(groupName))) {
      return { status: 'already-loaded', toolNames: this._loadedLazyToolNames(groupNames) };
    }

    const requestedToolNames = new Set<WebToolName>(
      groupNames.flatMap((groupName) => [...webToolGroups[groupName]]),
    );

    const toolsToRegister = (await this._getToolsToRegister(tableauAuthInfo)).filter(
      (tool) =>
        requestedToolNames.has(tool.name) && !this._registeredLazyWebToolNames.has(tool.name),
    );

    for (const tool of toolsToRegister) {
      await this._registerWebTool(tool);
      this._registeredLazyWebToolNames.add(tool.name);
    }
    for (const groupName of groupNames) {
      this._loadedLazyWebToolGroups.add(groupName);
    }

    return { status: 'loaded', toolNames: this._loadedLazyToolNames(groupNames) };
  };

  private _loadedLazyToolNames = (groupNames: readonly WebToolGroupName[]): WebToolName[] =>
    groupNames.flatMap((groupName) =>
      webToolGroups[groupName].filter((toolName) => this._registeredLazyWebToolNames.has(toolName)),
    );

  private _registerLoadWebToolsTool = (): void => {
    this.mcpServer.registerTool(
      LOAD_WEB_TOOLS_TOOL_NAME,
      {
        title: 'Load Web Tools',
        description: 'Load a Tableau web tool group.',
        inputSchema: loadWebToolsParamsSchema,
        annotations: {
          title: 'Load Web Tools',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (
        args: { group: LoadableWebToolGroupName },
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ): Promise<CallToolResult> => {
        const config = getConfig();
        if (config.breakGlassDisableGlobally) {
          throw new ServiceUnavailableError(
            'The Tableau MCP server is temporarily unavailable. Please try again later.',
          );
        }
        const result = await this.loadWebTools(args.group, getTableauAuthInfo(extra.authInfo));
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );
  };

  private _registerWebTool = async (tool: WebTool<any>): Promise<void> => {
    const config = getConfig();
    const mcpAppsEnabled = await getFeatureGate().isFeatureEnabled('mcp-apps');

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
            tableauRequestHandlerExtra._userLuid ?? getTableauAuthInfo(extra.authInfo)?.userId ?? ''
          );
        },
        setUserLuid(userLuid: string) {
          tableauRequestHandlerExtra._userLuid = userLuid;
        },
        getSiteLuid() {
          return (
            tableauRequestHandlerExtra._siteLuid ?? getTableauAuthInfo(extra.authInfo)?.siteId ?? ''
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

    if (mcpAppsEnabled && tool.app) {
      await this._registerAppTool(tool, toolCallback);
    } else {
      await this._registerTool(tool, toolCallback);
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
