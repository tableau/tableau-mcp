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
import { buildDesktopInstructions } from './desktop/routeTable.js';
import { SessionManager } from './desktop/sessionManager.js';
import { log } from './logging/logger.js';
import { ClientInfo, Server } from './server.js';
import { getCheckForUserChangesTool } from './tools/desktop/session/checkForUserChanges.js';
import { getListInstancesTool } from './tools/desktop/session/listInstances.js';
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
 * EXPERIMENT (experiment/spec-loop-studio): the ruthless spec-loop-first surface,
 * selected by TOOL_PROFILE=spec-loop. Hypothesis under test: the native semantic
 * loop — generate-viz-from-notional-spec for charts, the whole-document GET/POST
 * for calcs, both dispatched through execute-tableau-command on the /v0 External
 * API — is sufficient on its own, with NO XML tools, NO templates, NO bind-template.
 * Everything a chart/calc/dashboard ask needs routes through execute-tableau-command;
 * the rest is discovery + readback (on apiVersion <=0.1.0 the /v0 generic route was
 * write-blind, so the list-* tools were how the model observed state). Proven by hand
 * 2026-07-19: a full analytics workbook (calcs + charts + dashboard) authored live in
 * seconds, zero XML.
 * The known-command guard (from #542) makes the single execute-tableau-command tool
 * safe against hallucinated verbs.
 */
export const SPEC_LOOP_TOOL_PROFILE: ReadonlySet<DesktopToolName> = new Set<DesktopToolName>([
  'execute-tableau-command',
  'list-instances',
  'list-available-fields',
  'list-worksheets',
  'list-dashboards',
]);

/**
 * The full SINGABLE surface, selected by TOOL_PROFILE=dynamic-authoring: the spec-loop
 * five (charts/dashboards via generate-viz-from-notional-spec + discovery/readback
 * through execute-tableau-command) PLUS the five author-* verbs that make the WHOLE
 * dynamic dialect authorable with ZERO agent-visible XML — author-calc (ratios/rank/
 * running-total/LOD), author-set (param-linked Top/Bottom-N), author-parameter (the
 * key signature, born at OPEN), author-action (parameter-change wiring), format-labels
 * (mark labels) — PLUS ask-user (ambiguity goes to the human, never to a guess) and
 * search-commands (how the singer discovers the execute-tableau-command dialect) — PLUS
 * bind-template, the deterministic fast-path (no LLM, ~0.3s) for plain chart shapes,
 * and refine-worksheet, the primitives-only top-N/sort editor that carries
 * edit-in-place now that the notional-spec loop is retired.
 * PLUS the two knowledge doors — list-knowledge-resources + read-knowledge-resource —
 * without which the system prompt's "consult the expertise library BEFORE authoring"
 * instruction had no tool to route to: the singer could not read the curated corpus at
 * all, so verified Tableau behavior (e.g. the waterfall subtotal/total exclusion rule,
 * the Top-N-needs-a-context-filter rule) stayed dark on every sing. The corpus is
 * served as MCP resources anyway; these two tiny tools are the only way the model reaches it.
 * Twenty-one tools cover the full Workout-Wednesday-W44 dialect plus on-demand expertise
 * and first-class workbook/data reads;
 * no raw XML get/apply, no cache, no validation. This is the "make it shorter" answer — a
 * lean, semantically-named surface under the 46k tools/list cliff, not a describe-stub trim
 * of the 45-tool default. Mechanism map live-proven 2026-07-19 (CODA): calcs/sets/
 * actions/formatting MERGE; parameters born at OPEN via author-parameter.
 */
export const DYNAMIC_AUTHORING_TOOL_PROFILE: ReadonlySet<DesktopToolName> =
  new Set<DesktopToolName>([
    'bind-template',
    'refine-worksheet',
    'execute-tableau-command',
    'search-commands',
    'ask-user',
    'list-instances',
    'list-available-fields',
    'list-worksheets',
    'list-dashboards',
    'get-summary-data',
    'get-workbook-inventory',
    'list-workbook-datasources',
    'list-site-datasources',
    'author-calc',
    'author-set',
    'author-parameter',
    'author-action',
    'format-labels',
    'list-knowledge-resources',
    'read-knowledge-resource',
    'search-knowledge',
  ]);

/**
 * Select the tools to register for a given TOOL_PROFILE value (already normalized by
 * Config: trim + lowercase). '' (unset) → the lean {@link DYNAMIC_AUTHORING_TOOL_PROFILE}
 * native surface: the Desktop authoring server SINGS in native Tableau by default, no
 * env var required. 'full' → every tool including the raw XML get/apply surface (the
 * explicit opt-in escape hatch). 'demo' / 'spec-loop' → their named subsets;
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

export { DATA_ROOT, RESOURCES_ROOT };

// Routing guidance every connecting client receives at initialize (W60 adoption P5 —
// the demo build previously shipped NO instructions, so skill-less clients got zero
// routing and the template fast path stayed dark in real sessions). Generated from the
// typed route table so route edits are pinned by tests instead of drifting as prose.
export const DESKTOP_INSTRUCTIONS = buildDesktopInstructions({ sessionPinned: false });

export class DesktopMcpServer extends Server {
  private readonly sessionManager = new SessionManager();

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    super({
      mcpServer,
      clientInfo,
      serverName,
      serverVersion,
      instructions: buildDesktopInstructions({
        sessionPinned: getDesktopConfig().desktopSessionId !== undefined,
      }),
    });
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
    const config = getDesktopConfig();
    const excluded = new Set<(server: DesktopMcpServer) => DesktopTool<any>>();

    // check-for-user-changes needs the events endpoint, which the External Client API does not
    // expose; don't advertise a tool that can only return an error on that transport.
    if (config.externalApiEnabled) {
      excluded.add(getCheckForUserChangesTool);
    }

    // When the launching Desktop pinned a session, every tool defaults to it, so
    // list-instances has nothing to add — dropping it keeps the agent from ever
    // spending a turn discovering which instance to control.
    if (config.desktopSessionId !== undefined) {
      excluded.add(getListInstancesTool);
    }

    const factories = [
      ...desktopToolFactories,
      ...(config.episodeEventsEnabled ? episodeToolFactories : []),
    ].filter((factory) => !excluded.has(factory));
    const allTools = factories.map((toolFactory) => toolFactory(this));
    return selectToolsForProfile(allTools, config.toolProfile);
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
