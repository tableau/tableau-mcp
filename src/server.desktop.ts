import { McpServer, ResourceTemplate, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ServerNotification,
  ServerRequest,
  Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json';
import { getDesktopConfig } from './config.desktop.js';
import {
  DATA_ROOT,
  getConfiguredKnowledgeDir,
  readResourceAsset,
  RESOURCES_ROOT,
} from './desktop/assets.js';
import { createCallDeadline } from './desktop/callDeadline.js';
import {
  emitEpisodeEvent,
  TOOL_PROFILE_NAMES,
  type ToolSchemaProfile,
} from './desktop/episode-events.js';
import { apiVersionAtLeast } from './desktop/externalApi/apiVersion.js';
import { discoverInstances } from './desktop/externalApi/discovery.js';
import { ExternalApiInstance } from './desktop/externalApi/types.js';
import { DESKTOP_MCP_NAME } from './desktop/externalApi/userAgent.js';
import { buildDesktopInstructions } from './desktop/instructions.js';
import {
  getKnowledgeCorpusEntryCount,
  listKnowledgeResources,
  readKnowledgeResource,
} from './desktop/knowledge/index.js';
import { SessionManager } from './desktop/session/sessionManager.js';
import { log } from './logging/logger.js';
import { ClientInfo, Server } from './server.js';
import { registerSkills } from './skills/index.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { TableauDesktopRequestHandlerExtra } from './tools/desktop/toolContext.js';
import { DesktopToolName } from './tools/desktop/toolName.js';
import { desktopToolFactories, episodeToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

const serverName = DESKTOP_MCP_NAME;
const serverVersion = pkg.version;

/**
 * Small tool set for demos, selected by TOOL_PROFILE=demo. Registering fewer tools keeps the
 * serialized schemas small, which cuts per-turn latency and token cost. It holds the fast-path
 * and coordination tools plus the fallback chain (get-workbook-xml, inject-template,
 * apply-worksheet) the model needs when the fast path cannot finish. It keeps the older
 * template binder path because it does not include the modern artifact builder. Experimental:
 * it may change or be removed in a minor release.
 */
export const DEMO_TOOL_PROFILE: ReadonlySet<DesktopToolName> = new Set<DesktopToolName>([
  'bind-template',
  'run-dashboard-batch',
  'list-instances',
  'list-worksheets',
  'list-available-fields',
  'get-worksheet-xml',
  'apply-workbook',
  'get-workbook-xml',
  'inject-template',
  'apply-worksheet',
  'batch-create-and-cache-sheets',
  'build-and-apply-dashboard',
]);

/**
 * Minimal tool set that drives Tableau through execute-tableau-command alone, selected by
 * TOOL_PROFILE=spec-loop. Charts, calcs and dashboards all go through that one tool, with no XML
 * authoring tools, templates, or bind-template. The rest is discovery and readback tools so the
 * model can observe state. get-worksheet-xml is in every profile so existing sheets can be
 * inspected and edited before any authoring attempt. Experimental: it may change or be removed
 * in a minor release.
 */
export const SPEC_LOOP_TOOL_PROFILE: ReadonlySet<DesktopToolName> = new Set<DesktopToolName>([
  'execute-tableau-command',
  'list-instances',
  'list-available-fields',
  'get-worksheet-xml',
  'list-worksheets',
  'list-dashboards',
]);

/**
 * The default tool set, used when TOOL_PROFILE is unset or `dynamic-authoring`. It is the lean
 * native authoring surface: the spec-loop tools, the author-* tools (calcs, sets, parameters,
 * actions), format-worksheets, ask-user, and search-commands for finding the
 * execute-tableau-command dialect. It adds bind-template for single-view asks, the guarded
 * template artifact fallback, and refine-worksheet for top-N and sort edits in place. It also
 * includes the two knowledge tools (search-knowledge and read-knowledge-resource), because the
 * instructions tell the model to consult the expertise library before authoring and these are
 * the only way it can read that library. Workbook and data reads, navigation, dialog handling
 * and scoped cached-XML fallbacks are included. Standalone validation and unrelated info tools
 * are left out, and clients that need more can use TOOL_PROFILE=full.
 */
export const DYNAMIC_AUTHORING_TOOL_PROFILE: ReadonlySet<DesktopToolName> =
  new Set<DesktopToolName>([
    'bind-template',
    'list-templates',
    'build-worksheets-from-templates',
    'refine-worksheet',
    'add-field',
    'remove-field',
    'resolve-field',
    // The manual field-edit path's read leg: mints the worksheetFile cache path that
    // add-field/remove-field/apply-worksheet consume. Without it the manual path cannot start.
    'get-worksheet-xml',
    'get-dashboard-xml',
    'get-storyboard-xml',
    'get-workbook-xml',
    'export-worksheet-image',
    'export-dashboard-image',
    'export-storyboard-image',
    // The edit leg. apply-* no longer accepts a document, so the agent needs a way to
    // read a slice of the cached file and splice an edit back into it. Without these
    // two, an edit that add-field/remove-field/refine-worksheet cannot express has no
    // route at all.
    'read-cached-xml',
    'write-cached-xml',
    'apply-worksheet',
    'apply-dashboard',
    'apply-storyboard',
    'apply-workbook',
    'apply-workbook-style',
    'inspect-custom-theme',
    'export-custom-theme',
    'run-dashboard-batch',
    'execute-tableau-command',
    'search-commands',
    // Atomic navigation fallback: switch the workbook active window directly.
    'activate-sheet',
    'delete-sheet',
    'rename-sheet',
    'sort-worksheet',
    'show-me',
    'add-worksheet',
    'add-dashboard',
    'add-storyboard',
    'compose-story',
    'open-file',
    'set-start-page-visibility',
    'save-workbook',
    'workbook-export-as',
    'pause-auto-updates',
    'refresh-auto-updates',
    'refresh-storyboard-auto-updates',
    'refresh-dashboard-auto-updates',
    'resume-auto-updates',
    // Workbook-level undo/redo — recover from a bad edit without hand-reverting XML.
    'undo-workbook',
    'redo-workbook',
    'ask-user',
    'list-instances',
    'get-desktop-state',
    'get-diagnostics',
    'get-active-dialogs',
    'invoke-dialog-action',
    'list-available-fields',
    'search-workbook-fields',
    'list-worksheets',
    'get-show-me-options',
    'list-dashboards',
    'get-summary-data',
    'list-worksheet-logical-tables',
    'get-worksheet-underlying-data',
    'capture-window-screenshot',
    'get-workbook-inventory',
    'list-workbook-datasources',
    'get-datasource-info',
    'get-datasource-xml',
    'apply-datasource',
    'refresh-datasource-data',
    'refresh-datasource-extract',
    'author-calc',
    'author-set',
    'author-parameter',
    'author-action',
    'format-worksheets',
    'format-dashboard-zones',
    'set-member-colors',
    'read-knowledge-resource',
    'search-knowledge',
  ]);

/**
 * Select the tools to register for a TOOL_PROFILE value (already trimmed and lowercased by
 * Config). Unset or `dynamic-authoring` gives the default lean set. `demo` and `spec-loop` give
 * their named subsets. `full` and `combined-lean` give every Desktop tool (the lean half of
 * `combined-lean` is the Web side, handled by WebMcpServer). Any other value logs a warning and
 * gives the default set. Pure apart from that warning, so it can be unit-tested without the
 * server or env.
 */
export function selectToolsForProfile<T extends { name: DesktopToolName }>(
  tools: T[],
  profile: string,
): T[] {
  if (profile === '' || profile === 'dynamic-authoring') {
    return selectDefaultTools(tools);
  }
  if (profile === 'demo') {
    return tools.filter((tool) => DEMO_TOOL_PROFILE.has(tool.name));
  }
  if (profile === 'spec-loop') {
    return tools.filter((tool) => SPEC_LOOP_TOOL_PROFILE.has(tool.name));
  }
  if (profile === 'full' || profile === 'combined-lean') {
    return tools;
  }
  log({
    message: `Unknown TOOL_PROFILE "${profile}"; expected one of ${TOOL_PROFILE_NAMES.join(', ')}. Using the default (dynamic-authoring).`,
    level: 'warning',
    logger: 'DesktopMcpServer',
  });
  return selectDefaultTools(tools);
}

function selectDefaultTools<T extends { name: DesktopToolName }>(tools: T[]): T[] {
  return tools.filter((tool) => DYNAMIC_AUTHORING_TOOL_PROFILE.has(tool.name));
}

/**
 * The External Client API version the registration gate compares tool floors against: the
 * pinned instance's version when pinned, otherwise the highest version among live instances
 * (undefined when none is known, which fails the gate open).
 *
 * Unpinned resolves the highest — not the newest-started — so a tool is hidden only when no
 * running Desktop can serve it; whether the instance a call actually reaches serves it is a
 * per-call concern, not the gate's.
 */
export function resolveConnectedApiVersion(
  instances: Array<ExternalApiInstance>,
  pinnedSessionId: string | undefined,
): string | undefined {
  if (pinnedSessionId !== undefined) {
    return instances.find((instance) => String(instance.pid) === pinnedSessionId)?.apiVersion;
  }
  return instances.reduce<string | undefined>(
    (highest, instance) =>
      instance.apiVersion !== undefined &&
      (highest === undefined || apiVersionAtLeast(instance.apiVersion, highest))
        ? instance.apiVersion
        : highest,
    undefined,
  );
}

/**
 * Drop tools whose {@link DesktopTool.minApiVersion} floor exceeds the connected Desktop's
 * API version. Fails open: an unknown connected version keeps every tool, leaving the
 * per-call `endpointNotInThisBuild` guard as the backstop.
 */
export function filterToolsByApiVersion<T extends { minApiVersion?: string }>(
  tools: T[],
  connectedApiVersion: string | undefined,
): T[] {
  if (connectedApiVersion === undefined) {
    return tools;
  }
  return tools.filter(
    (tool) =>
      tool.minApiVersion === undefined ||
      apiVersionAtLeast(connectedApiVersion, tool.minApiVersion),
  );
}

export { DATA_ROOT, RESOURCES_ROOT };

// Default (unpinned) routing guidance sent at initialize, so clients without a skill still
// get routing for the template fast path. The server builds per-session text at connect time,
// and demo and spec-loop get different text. Generated from the typed route table so route
// edits are pinned by tests instead of drifting as prose.
export const DESKTOP_INSTRUCTIONS = buildDesktopInstructions({ sessionPinned: false });

export class DesktopMcpServer extends Server {
  private readonly sessionManager = new SessionManager();
  private knowledgeCorpusChecked = false;

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({
      mcpServer,
      clientInfo,
      serverName,
      serverVersion,
      instructions: buildDesktopInstructions({
        sessionPinned: getDesktopConfig().desktopSessionId !== undefined,
        profile: getDesktopConfig().toolProfile,
      }),
    });
  }

  registerResources = async (): Promise<void> => {
    if (!this.knowledgeCorpusChecked) {
      this.knowledgeCorpusChecked = true;
      if (getKnowledgeCorpusEntryCount() === 0) {
        const configuredDir = getConfiguredKnowledgeDir();
        log({
          message: configuredDir
            ? `Knowledge corpus is empty; expected assets under ${configuredDir}`
            : 'Knowledge corpus is empty; set TABLEAU_KNOWLEDGE_DIR to a knowledge root to serve one',
          level: 'warning',
          logger: 'DesktopMcpServer',
        });
      }
    }
    await this._registerDashboardXmlGuide();
    this._registerKnowledgeResources();
  };

  registerTools = async (): Promise<void> => {
    const config = getDesktopConfig();
    const tools = await this._getToolsToRegister();
    const listedTools = await Promise.all(tools.map(getDesktopToolListEntry));

    log({
      message: 'Desktop transport ACTIVE: External Client API (Athena V0)',
      level: 'info',
      logger: 'DesktopMcpServer',
    });

    for (const { name, title, description, paramsSchema, annotations, callback } of tools) {
      const toolCallback: ToolCallback<typeof paramsSchema> = async (
        args: typeof paramsSchema,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => {
        const tableauToolCallback = await Provider.from(callback);
        // One clock per tool call, composed into extra.signal so the socket really aborts.
        const deadline = createCallDeadline({
          clientSignal: extra.signal,
          budgetMs: config.desktopCallTimeoutMs,
        });

        try {
          const tableauRequestHandlerExtra: TableauDesktopRequestHandlerExtra = {
            ...extra,
            signal: deadline.signal,
            deadline,
            config,
            getExecutor: async (sessionId: string) => {
              return await this.sessionManager.getExecutor(sessionId);
            },
            server: this,
          };

          return await tableauToolCallback(args, tableauRequestHandlerExtra);
        } finally {
          deadline.dispose();
        }
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

    const instructions = buildDesktopInstructions({
      sessionPinned: config.desktopSessionId !== undefined,
      profile: config.toolProfile,
    });
    await emitEpisodeEvent(config, {
      type: 'tool_schemas_registered',
      surface: 'desktop',
      profile: normalizeToolSchemaProfile(config.toolProfile),
      tool_count: listedTools.length,
      schemas_json_chars: JSON.stringify(listedTools).length,
      instructions_chars: instructions.length,
    });

    // Slim tools/list (no $schema dialect tags): only when this server owns the
    // McpServer. On the combined variant's shared server, overriding tools/list
    // would hide the web half's tools (including ones combined-lean registers late).
    if (this.ownsMcpServer) {
      this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: listedTools,
      }));
    }

    await this.enableSkillsCapability();
    await registerSkills(this);
  };

  protected _getToolsToRegister = async (): Promise<Array<DesktopTool<any>>> => {
    const config = getDesktopConfig();
    const factories = [
      ...desktopToolFactories,
      ...(config.episodeEventsEnabled ? episodeToolFactories : []),
    ];
    const allTools = factories.map((toolFactory) => toolFactory(this));
    const profileTools = selectToolsForProfile(allTools, config.toolProfile);

    const instances = discoverInstances({ discoveryDir: config.externalApiDiscoveryDir });
    const connectedApiVersion = resolveConnectedApiVersion(instances, config.desktopSessionId);
    const gatedTools = filterToolsByApiVersion(profileTools, connectedApiVersion);

    if (gatedTools.length < profileTools.length) {
      const dropped = profileTools
        .filter((tool) => !gatedTools.includes(tool))
        .map((tool) => tool.name);
      log({
        message: `Hiding ${dropped.length} tool(s) the connected Desktop API v${connectedApiVersion} does not serve: ${dropped.join(', ')}`,
        level: 'info',
        logger: 'DesktopMcpServer',
      });
    }
    return gatedTools;
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
      description:
        'Expertise modules scanned from the configured knowledge root (TABLEAU_KNOWLEDGE_DIR)',
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
      throw new McpError(ErrorCode.InternalError, 'Dashboard layout guide asset not found.');
    }
    this.registerResource({
      name: 'dashboard-xml-guide',
      uri: 'tableau://docs/dashboard-xml-guide',
      title: 'Dashboard layout editing guide',
      description: 'Zone positioning, layouts, and best practices for dashboard editing',
      text,
      mimeType: 'text/markdown',
    });
  };
}

function normalizeToolSchemaProfile(profile: string): ToolSchemaProfile {
  return (TOOL_PROFILE_NAMES as readonly string[]).includes(profile)
    ? (profile as ToolSchemaProfile)
    : 'dynamic-authoring';
}

export async function getDesktopToolListEntry(tool: DesktopTool<any>): Promise<McpTool> {
  const paramsSchema = await Provider.from(tool.paramsSchema);
  const objectSchema = normalizeObjectSchema(paramsSchema as any);
  const inputSchema = (
    objectSchema
      ? toJsonSchemaCompat(objectSchema, { strictUnions: true, pipeStrategy: 'input' } as any)
      : { type: 'object' as const, properties: {} }
  ) as McpTool['inputSchema'] & { $schema?: string };
  delete inputSchema.$schema;

  return {
    name: tool.name,
    title: await Provider.from(tool.title),
    description: await Provider.from(tool.description),
    inputSchema,
    annotations: await Provider.from(tool.annotations),
  };
}
