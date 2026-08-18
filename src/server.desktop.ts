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
import { DATA_ROOT, readResourceAsset, RESOURCES_ROOT } from './desktop/assets.js';
import { createCallDeadline } from './desktop/callDeadline.js';
import { emitEpisodeEvent, type ToolSchemaProfile } from './desktop/episode-events.js';
import { apiVersionAtLeast } from './desktop/externalApi/apiVersion.js';
import { discoverInstances } from './desktop/externalApi/discovery.js';
import { ExternalApiInstance } from './desktop/externalApi/types.js';
import { buildDesktopInstructions } from './desktop/instructions.js';
import {
  getKnowledgeCorpusEntryCount,
  getKnowledgeDir,
  listKnowledgeResources,
  readKnowledgeResource,
} from './desktop/knowledge/index.js';
import { SessionManager } from './desktop/session/sessionManager.js';
import { log } from './logging/logger.js';
import { ClientInfo, Server } from './server.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { TableauDesktopRequestHandlerExtra } from './tools/desktop/toolContext.js';
import { DesktopToolName } from './tools/desktop/toolName.js';
import { desktopToolFactories, episodeToolFactories } from './tools/desktop/tools.js';
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
 * list-worksheets already overlap). Demo retains the legacy binder path because it does not
 * include the modern artifact builder.
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
 * EXPERIMENT (experiment/spec-loop-studio): the ruthless spec-loop-first surface,
 * selected by TOOL_PROFILE=spec-loop. Hypothesis under test: the native semantic
 * loop — generate-viz-from-notional-spec for charts, the whole-document GET/POST
 * for calcs, both dispatched through execute-tableau-command on the /v0 External
 * API — is sufficient with no XML authoring tools, templates, or bind-template.
 * Everything a chart/calc/dashboard ask needs routes through execute-tableau-command;
 * the rest is discovery + readback (on apiVersion <=0.1.0 the /v0 generic route was
 * write-blind, so the list-* tools were how the model observed state). get-worksheet-xml
 * is retained across every profile for existing-sheet inspection and edits, including
 * before any authoring attempt. Proven by hand 2026-07-19: a full analytics workbook (calcs +
 * charts + dashboard) authored live in seconds, zero agent-authored XML.
 * The known-command guard (from #542) makes the single execute-tableau-command tool
 * safe against hallucinated verbs.
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
 * The full SINGABLE surface, selected by TOOL_PROFILE=dynamic-authoring: the spec-loop
 * five (charts/dashboards via generate-viz-from-notional-spec + discovery/readback
 * through execute-tableau-command) PLUS the five author-* verbs that keep the primary
 * semantic path agent-XML-free — author-calc (ratios/rank/
 * running-total/LOD), author-set (param-linked Top/Bottom-N), author-parameter (the
 * key signature, born at OPEN), author-action (parameter-change wiring), format-labels
 * (mark labels) — PLUS ask-user (ambiguity goes to the human, never to a guess) and
 * search-commands (how the singer discovers the execute-tableau-command dialect) — PLUS
 * the list/build/apply template artifact flow and refine-worksheet, the primitives-only
 * top-N/sort editor that carries
 * edit-in-place now that the notional-spec loop is retired.
 * PLUS the two knowledge doors — search-knowledge + read-knowledge-resource —
 * without which the system prompt's "consult the expertise library BEFORE authoring"
 * instruction had no tool to route to: the singer could not read the curated corpus at
 * all, so verified Tableau behavior (e.g. the waterfall subtotal/total exclusion rule,
 * the Top-N-needs-a-context-filter rule) stayed dark on every sing. The corpus is
 * served as MCP resources anyway; these two tiny tools are the only way the model reaches it.
 * Fifty-two tools cover the full Workout-Wednesday-W44 dialect plus on-demand expertise,
 * first-class workbook/data reads/navigation, scoped dashboard/story cached-XML fallbacks, and a
 * narrow whole-workbook cached-XML fallback. Standalone validation and unrelated info/site tools
 * stay out. This is the
 * "make it shorter" answer — a lean, semantically-named surface under the 46k tools/list cliff,
 * not a describe-stub trim of the 45-tool default. Mechanism map live-proven 2026-07-19 (CODA):
 * calcs/sets/actions/formatting MERGE; parameters born at OPEN via author-parameter.
 */
export const DYNAMIC_AUTHORING_TOOL_PROFILE: ReadonlySet<DesktopToolName> =
  new Set<DesktopToolName>([
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
    'run-dashboard-batch',
    'execute-tableau-command',
    'search-commands',
    // Atomic navigation fallback: switch the workbook active window directly.
    'activate-sheet',
    'delete-sheet',
    'rename-sheet',
    'sort-worksheet',
    'add-worksheet',
    'add-dashboard',
    'add-storyboard',
    'open-file',
    'save-workbook',
    'pause-auto-updates',
    'resume-auto-updates',
    // Workbook-level undo/redo — recover from a bad edit without hand-reverting XML.
    'undo-workbook',
    'redo-workbook',
    'ask-user',
    'list-instances',
    'list-available-fields',
    'list-worksheets',
    'list-dashboards',
    'get-summary-data',
    'list-worksheet-logical-tables',
    'get-worksheet-underlying-data',
    'get-workbook-inventory',
    'list-workbook-datasources',
    'list-site-datasources',
    'author-calc',
    'author-set',
    'author-parameter',
    'author-action',
    'format-labels',
    'read-knowledge-resource',
    'search-knowledge',
  ]);

/**
 * Select the tools to register for a given TOOL_PROFILE value (already normalized by
 * Config: trim + lowercase). '' (unset) → the lean {@link DYNAMIC_AUTHORING_TOOL_PROFILE}
 * native surface: the Desktop authoring server SINGS in native Tableau by default, no
 * env var required. 'full' → every tool, including unrelated info/site/validation tools.
 * 'demo' / 'spec-loop' → their named subsets;
 * 'combined-lean' → the full desktop surface (its lean half is the web side, handled by
 * WebMcpServer). Any other value → full set + a logged warning. Pure and side-effect-free
 * apart from the warning log, so the selection can be unit-tested without the server or env.
 */
export function selectToolsForProfile<T extends { name: DesktopToolName }>(
  tools: T[],
  profile: string,
): T[] {
  if (profile === '' || profile === 'dynamic-authoring') {
    return tools.filter((tool) => DYNAMIC_AUTHORING_TOOL_PROFILE.has(tool.name));
  }
  if (profile === 'demo') {
    return tools.filter((tool) => DEMO_TOOL_PROFILE.has(tool.name));
  }
  if (profile === 'spec-loop') {
    return tools.filter((tool) => SPEC_LOOP_TOOL_PROFILE.has(tool.name));
  }
  // 'combined-lean' means "full desktop surface, lazy web surface" — the web half is
  // handled by WebMcpServer; the desktop half registers everything, same as 'full'.
  if (profile !== 'full' && profile !== 'combined-lean') {
    log({
      message: `Unknown TOOL_PROFILE "${profile}" — registering the full tool set.`,
      level: 'warning',
      logger: 'DesktopMcpServer',
    });
  }
  return tools;
}

/**
 * Pick the External Client API version to gate against from the discovered instances
 * (newest-first): the pinned session's instance when pinned, else the newest. Undefined —
 * which makes the gate fail open — when no instance matches, so a not-yet-written discovery
 * file never hides tools.
 *
 * Interim: the planned `GET /v0/capabilities` endpoint is the eventual source of truth for
 * whether an endpoint is served, and replaces this discovery-file version read.
 */
export function resolveConnectedApiVersion(
  instances: Array<ExternalApiInstance>,
  pinnedSessionId: string | undefined,
): string | undefined {
  if (pinnedSessionId !== undefined) {
    return instances.find((instance) => String(instance.pid) === pinnedSessionId)?.apiVersion;
  }
  return instances[0]?.apiVersion;
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

// Routing guidance every connecting client receives at initialize (W60 adoption P5 —
// the demo build previously shipped NO instructions, so skill-less clients got zero
// routing and the template fast path stayed dark in real sessions). Generated from the
// typed route table so route edits are pinned by tests instead of drifting as prose.
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
        log({
          message: `Knowledge corpus is empty; expected assets under ${getKnowledgeDir()}`,
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
  if (profile === '' || profile === 'dynamic-authoring') return 'dynamic-authoring';
  if (
    profile === 'demo' ||
    profile === 'spec-loop' ||
    profile === 'full' ||
    profile === 'combined-lean'
  ) {
    return profile;
  }
  return 'unknown';
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
