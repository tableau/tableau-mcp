import { type CallToolResult, McpServer, type Tool as McpTool } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';

import * as configModule from './config.desktop.js';
import * as episodeEvents from './desktop/episode-events.js';
import { apiVersionAtLeast, MIN_SUPPORTED_API_VERSION } from './desktop/externalApi/apiVersion.js';
import { makeExecutorMock } from './desktop/externalApi/executor.mock.js';
import { ExternalApiInstance } from './desktop/externalApi/types.js';
import {
  buildDesktopInstructions,
  EXPERTISE_TOOL_NAMES,
  SESSION_RESOLUTION_TEXT_PINNED,
  SESSION_RESOLUTION_TEXT_UNPINNED,
} from './desktop/instructions.js';
import { SessionManager } from './desktop/session/sessionManager.js';
import { DesktopApiVersionTooOldError } from './errors/mcpToolError.js';
import * as loggerModule from './logging/logger.js';
import {
  ALWAYS_LOAD_TOOL_NAMES,
  assertServesApiVersion,
  DEMO_TOOL_PROFILE,
  DESKTOP_INSTRUCTIONS,
  DesktopMcpServer,
  DYNAMIC_AUTHORING_TOOL_PROFILE,
  filterToolsByApiVersion,
  getDesktopToolListEntry,
  getModelFacingToolEntry,
  pinnedApiVersion,
  selectToolsForProfile,
  stripEmptySchemaNoise,
  warnIfUnsupportedApiVersion,
  withoutUnservedExpertiseTools,
} from './server.desktop.js';
import { buildWebInstructions } from './server.web.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { getMockRequestHandlerExtra } from './tools/desktop/toolContext.mock.js';
import { desktopToolNames } from './tools/desktop/toolName.js';
import { desktopToolFactories, episodeToolFactories } from './tools/desktop/tools.js';
import { toStandardSchema } from './tools/toolContext.js';
import { Provider } from './utils/provider.js';

type ToolsListHandler = (params: unknown, ctx: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  mockFeatureGate: {
    isFeatureEnabled: vi.fn((_featureName: string) => false),
  },
  expertiseCorpusEntryCount: vi.fn(() => 1),
}));

vi.mock('./desktop/expertise/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./desktop/expertise/index.js')>()),
  getExpertiseCorpusEntryCount: mocks.expertiseCorpusEntryCount,
}));

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('DesktopMcpServer', () => {
  beforeEach(() => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
    mocks.expertiseCorpusEntryCount.mockReturnValue(1);
  });

  it('should register tools', async () => {
    // Pin the full surface: this test is about registration mechanics (every tool
    // registered with its title/schema/annotations), independent of the profile
    // default (unset now selects the lean dynamic-authoring surface).
    vi.stubEnv('TOOL_PROFILE', 'full');
    const server = getServer();
    await server.registerTools();

    const allTools = desktopToolFactories.map((toolFactory) => toolFactory(server));
    const disabledFlags = await Promise.all(allTools.map((tool) => Provider.from(tool.disabled)));
    const tools = allTools.filter((tool, i) => !disabledFlags[i]);
    expect(server.mcpServer.registerTool).toHaveBeenCalledTimes(tools.length);
    for (const tool of tools) {
      expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
        tool.name,
        {
          title: await Provider.from(tool.title),
          description: await Provider.from(tool.description),
          inputSchema: toStandardSchema(await Provider.from(tool.paramsSchema)),
          annotations: await Provider.from(tool.annotations),
          ...(ALWAYS_LOAD_TOOL_NAMES.has(tool.name) && {
            _meta: { 'anthropic/alwaysLoad': true },
          }),
        },
        expect.any(Function),
      );
    }
  });

  it('registers list-instances even when a Desktop session is pinned', async () => {
    const base = configModule.getDesktopConfig();
    const spy = vi
      .spyOn(configModule, 'getDesktopConfig')
      .mockReturnValue({ ...base, desktopSessionId: '4242' });

    try {
      const server = getServer();
      await server.registerTools();

      const registeredNames = (
        vi.mocked(server.mcpServer.registerTool).mock.calls as Array<[string, ...unknown[]]>
      ).map(([name]) => name);
      expect(registeredNames).toContain('list-instances');
      expect(registeredNames).toContain('get-sheets');
    } finally {
      spy.mockRestore();
    }
  });

  it('registers list-instances when no Desktop session is pinned', async () => {
    const server = getServer();
    await server.registerTools();

    const registeredNames = (
      vi.mocked(server.mcpServer.registerTool).mock.calls as Array<[string, ...unknown[]]>
    ).map(([name]) => name);
    expect(registeredNames).toContain('list-instances');
  });

  it('serves tools/list without schema dialect metadata or duplicated annotation titles', async () => {
    vi.stubEnv('TOOL_PROFILE', 'full');
    const server = getServer();
    await server.registerTools();

    const setRequestHandler = vi.mocked(server.mcpServer.server.setRequestHandler);
    const listToolsCall = setRequestHandler.mock.calls.find(([method]) => method === 'tools/list');
    expect(listToolsCall).toBeDefined();

    const result = await (listToolsCall![1] as unknown as ToolsListHandler)({}, {});
    const tools = (result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.inputSchema).not.toHaveProperty('$schema');
      expect(tool.annotations).not.toHaveProperty('title');
    }
  });

  it('does not override tools/list on a shared McpServer (combined variant)', async () => {
    // The combined variant registers the web half on the same McpServer; a desktop
    // tools/list override there hides every web tool (caught live by the e2e suite).
    const config = configModule.getDesktopConfig();
    const desktopInstructions = buildDesktopInstructions({
      sessionPinned: config.desktopSessionId !== undefined,
      profile: config.toolProfile,
      expertiseAvailable: true,
    });
    const combinedInstructions = `${buildWebInstructions()} ${desktopInstructions}`;
    const sharedMcpServer = new McpServer(
      { name: 'shared', version: '0.0.0' },
      { instructions: combinedInstructions },
    );
    // The global McpServer mock records constructor arguments but does not mirror this SDK field.
    (sharedMcpServer.server as unknown as { _instructions?: string })._instructions =
      combinedInstructions;
    const server = new DesktopMcpServer({ mcpServer: sharedMcpServer });
    await server.registerTools();

    expect(server.ownsMcpServer).toBe(false);
    const listToolsCall = vi
      .mocked(sharedMcpServer.server.setRequestHandler)
      .mock.calls.find(([method]) => method === 'tools/list');
    expect(listToolsCall).toBeUndefined();
  });

  it('records the bounded registered schema surface without recording schemas', async () => {
    const base = configModule.getDesktopConfig();
    const configSpy = vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      episodeEventsEnabled: false,
      toolProfile: 'unexpected-profile',
    });
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();

    try {
      const server = getServer();
      const instructions = buildDesktopInstructions({
        sessionPinned: base.desktopSessionId !== undefined,
        profile: 'unexpected-profile',
        expertiseAvailable: true,
      });

      await server.registerTools();
      const listToolsCall = vi
        .mocked(server.mcpServer.server.setRequestHandler)
        .mock.calls.find(([method]) => method === 'tools/list');
      const listResult = await (listToolsCall![1] as unknown as ToolsListHandler)({}, {});
      const listedTools = (listResult as { tools: McpTool[] }).tools;

      expect(emitSpy).toHaveBeenCalledWith(expect.anything(), {
        type: 'tool_schemas_registered',
        surface: 'desktop',
        profile: 'dynamic-authoring',
        tool_count: listedTools.length,
        schemas_json_chars: JSON.stringify(
          listedTools.map(({ _meta, ...modelFacing }) => modelFacing),
        ).length,
        instructions_chars: instructions.length,
      });
      const event = emitSpy.mock.calls.at(-1)?.[1];
      expect(JSON.stringify(event)).not.toContain(String(listedTools[0]?.description));
    } finally {
      configSpy.mockRestore();
      emitSpy.mockRestore();
    }
  });
});

describe('DESKTOP_INSTRUCTIONS (generated from DESKTOP_ROUTE_TABLE)', () => {
  it('serves the modern instructions for the default profile', () => {
    expect(DESKTOP_INSTRUCTIONS).toBe(
      buildDesktopInstructions({ sessionPinned: false, profile: '', expertiseAvailable: true }),
    );
    expect(DESKTOP_INSTRUCTIONS).toContain('build-worksheets-from-templates');
    expect(DESKTOP_INSTRUCTIONS).toContain('bind-template');
    expect(DESKTOP_INSTRUCTIONS).toContain('auto_apply:true');
  });

  it('tells agents to narrate with Tableau vocabulary', () => {
    expect(DESKTOP_INSTRUCTIONS).toContain('Use Tableau terms: workbook/viz/sheet/field');
  });

  it('keeps pin-aware session guidance (list-instances, target another) when pinned', () => {
    const pinned = buildDesktopInstructions({ sessionPinned: true, expertiseAvailable: true });
    expect(pinned).toContain(SESSION_RESOLUTION_TEXT_PINNED);
    expect(pinned).toContain('list-instances');
    expect(pinned).not.toContain(SESSION_RESOLUTION_TEXT_UNPINNED);
  });
});

/** Serialize one tool entry for the per-tool size ratchets below. */
async function serializeDesktopToolSurface(tool: DesktopTool<any>): Promise<string> {
  return JSON.stringify(getModelFacingToolEntry(await getDesktopToolListEntry(tool)));
}

// Aggregate tools/list size is no longer a product contract: TAS discovers tools through search.
// Keep the selected profile and its instruction text pinned, plus per-tool caps below.
describe('desktop tools/list serialized surface', () => {
  it('registers highlight authoring on the existing author-action tool', async () => {
    const tools = desktopToolFactories.map((factory) => factory(new DesktopMcpServer()));
    const tool = tools.find((candidate) => candidate.name === 'author-action');
    expect(tool).toBeDefined();
    const surface = JSON.parse(await serializeDesktopToolSurface(tool!));
    expect(surface.inputSchema.properties.mode.enum).toContain('highlight');
    expect(surface.inputSchema.properties.highlightFields.type).toBe('array');
    expect(surface.inputSchema.properties.highlightBy.enum).toEqual([
      'all-fields',
      'dates-and-times',
    ]);
    expect(surface.inputSchema.properties.operation.enum).toEqual(['create', 'edit', 'delete']);
    expect(surface.inputSchema.properties.actionName.type).toBe('string');
    expect(surface.inputSchema.required ?? []).not.toContain('caption');
    expect(surface.inputSchema.required ?? []).not.toContain('sourceWorksheet');
    expect(surface.annotations.destructiveHint).toBe(true);
  });
  it('serves the selected dynamic authoring profile with pinned instructions', () => {
    const server = new DesktopMcpServer();
    const tools = desktopToolFactories.map((toolFactory) => toolFactory(server));
    const dynamicAuthoringTools = selectToolsForProfile(tools, 'dynamic-authoring');
    expect(new Set(dynamicAuthoringTools.map((tool) => tool.name))).toEqual(
      DYNAMIC_AUTHORING_TOOL_PROFILE,
    );

    // Tool search owns discovery; pin explicit authoring scope, merged filter recovery,
    // dense-scatter repair, executive-dashboard guidance, rounded-bar build/refine proof
    // route, and dashboard corner routing without restoring an aggregate tools/list ceiling.
    expect(DESKTOP_INSTRUCTIONS).toHaveLength(10_035);
  });
});

async function collectDesktopToolVocabularySurface(): Promise<string[]> {
  const server = new DesktopMcpServer();
  const values: string[] = [];

  const collectSchemaDescriptions = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectSchemaDescriptions(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;

    const record = value as Record<string, unknown>;
    if (typeof record.description === 'string') values.push(record.description);
    for (const nested of Object.values(record)) collectSchemaDescriptions(nested);
  };

  for (const toolFactory of desktopToolFactories) {
    const tool = toolFactory(server);
    const title = await Provider.from(tool.title);
    const description = await Provider.from(tool.description);
    if (typeof title === 'string') values.push(title);
    values.push(description);
    collectSchemaDescriptions((await getDesktopToolListEntry(tool)).inputSchema);
  }

  return values;
}

describe('desktop tools/list Tableau vocabulary', () => {
  it('does not expose XML in tool titles, descriptions, or parameter descriptions', async () => {
    const toolNamePattern = new RegExp(`\\b(${desktopToolNames.join('|')})\\b(?!-)`, 'g');
    const offenders = (await collectDesktopToolVocabularySurface())
      .filter((value) => /\bxml\b/i.test(value.replace(toolNamePattern, '')))
      .sort();

    expect(offenders).toEqual([]);
  });
});

describe('stripEmptySchemaNoise', () => {
  it('drops empty descriptions and string-only propertyNames at any depth', () => {
    const schema = {
      type: 'object',
      description: '',
      properties: {
        caption: { type: 'string', description: '' },
        filters: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} },
        list: { type: 'array', items: [{ type: 'string', description: '' }] },
      },
    };

    stripEmptySchemaNoise(schema);

    expect(schema).toEqual({
      type: 'object',
      properties: {
        caption: { type: 'string' },
        filters: { type: 'object', additionalProperties: {} },
        list: { type: 'array', items: [{ type: 'string' }] },
      },
    });
  });

  it('keeps real descriptions and constrained propertyNames', () => {
    const schema = {
      type: 'object',
      description: 'Kept.',
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
    };

    stripEmptySchemaNoise(schema);

    expect(schema).toEqual({
      type: 'object',
      description: 'Kept.',
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
    });
  });
});

describe('desktop tools/list per-tool byte accounting', () => {
  // Tool search owns aggregate discovery. Keep each individual tool bounded so a
  // schema cannot grow without its own measured, reviewable ratchet change.
  const PER_TOOL_BUDGET = 1_020;

  // Tools already over PER_TOOL_BUDGET at this base (feature/authoring @ 241a67e7).
  // Each value is the tool's CURRENT serialized size — a ceiling, NOT a target.
  // DO NOT GROW these: trim them down and lower/remove the entry. Never raise a
  // cap, and never add a new entry to dodge the budget without explicit sign-off.
  const GRANDFATHERED: ReadonlyMap<string, number> = new Map([
    // Re-baselined once, for the origin rule in paramOriginDescriptions.test.ts: a parameter
    // whose value comes from another call now names that call. The bytes bought a measured
    // fix, not prose — the stub describes on these three tools cost 69 failed add-field calls
    // (591s) and 299 repeat binds (2,562s) in shipped v10. Each number below is the CURRENT
    // measured size; the ratchet is unchanged, so trim rather than raise.
    ['bind-template', 2620], // ratcheted down 2026-11-18: zod 4 JSON Schema without additionalProperties/empty-description noise; raised 2026-11-10 for keep_large_pie: the user-confirmed way to keep a pie the slice gate blocked (#1203)
    ['add-field', 1367], // ratcheted down 2026-08-12: worksheetName/worksheetFile describes trimmed to fund the sticky edit-buffer nudge while staying under budget
    ['apply-worksheet', 1489], // ratcheted down 2026-11-18: zod 4 JSON Schema without additionalProperties/empty-description noise; ratcheted down 2026-08-19: worksheetName inferred from a cached fragment, describe drops the redundant "worksheet"; earlier ratchet 2026-08-12 trimming the worksheetName describe to id-or-name; earlier raise 2026-08-10: direct templatePlan folds an exact single-view build into the existing guarded apply tool; no new tool surface
    ['refine-worksheet', 1569], // ratcheted down with innermost nested-sort omit copy; do not grow
    ['build-worksheets-from-templates', 1127], // ratcheted down 2026-11-18: zod 4 JSON Schema without additionalProperties/empty-description noise; raised 2026-08-24: explicit Top-N artifact input keeps ranked executive views bounded before composition
    ['run-dashboard-batch', 1273], // remeasured after accepting an empty KPI list
    ['author-action', 2674], // raised 2026-11-23: caption, sourceField and targetSet get full-sentence describes (#1285); ratcheted down 2026-11-18: zod 4 JSON Schema without additionalProperties/empty-description noise; trimmed while adding identity-based edit/delete; do not grow
  ]);

  const measure = async (): Promise<Array<{ name: string; bytes: number }>> => {
    const server = new DesktopMcpServer();
    const table: Array<{ name: string; bytes: number }> = [];
    for (const toolFactory of desktopToolFactories) {
      const tool = toolFactory(server);
      table.push({ name: tool.name, bytes: (await serializeDesktopToolSurface(tool)).length });
    }
    return table.sort((a, b) => b.bytes - a.bytes);
  };

  const renderTable = (table: Array<{ name: string; bytes: number }>): string => {
    const width = Math.max(...table.map(({ bytes }) => String(bytes).length));
    return table.map(({ name, bytes }) => `  ${String(bytes).padStart(width)}  ${name}`).join('\n');
  };

  it('every tool is within budget (grandfathered offenders must not grow)', async () => {
    const table = await measure();

    const violations: string[] = [];
    for (const { name, bytes } of table) {
      const cap = GRANDFATHERED.get(name);
      if (cap !== undefined) {
        if (bytes > cap) {
          violations.push(
            `${name}: ${bytes} bytes — grew past its grandfathered cap of ${cap} (shrink it; do NOT raise the cap)`,
          );
        }
      } else if (bytes > PER_TOOL_BUDGET) {
        violations.push(
          `${name}: ${bytes} bytes — exceeds the ${PER_TOOL_BUDGET}-byte per-tool budget (trim description/schema)`,
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Desktop per-tool tools/list byte budget exceeded:\n${violations.join('\n')}\n\n` +
          `Full per-tool byte table (bytes desc):\n${renderTable(table)}`,
      );
    }
  });

  it('grandfather allowlist has no stale entries (keeps the ratchet honest)', async () => {
    const table = await measure();
    const bytesByName = new Map(table.map(({ name, bytes }) => [name, bytes]));

    const stale: string[] = [];
    for (const [name, cap] of GRANDFATHERED) {
      const bytes = bytesByName.get(name);
      if (bytes === undefined) {
        stale.push(`${name}: no longer a desktop tool — remove it from GRANDFATHERED`);
      } else if (bytes <= PER_TOOL_BUDGET) {
        stale.push(
          `${name}: now ${bytes} bytes (<= ${PER_TOOL_BUDGET}) — trimmed under budget, remove it from GRANDFATHERED`,
        );
      } else if (bytes < cap) {
        stale.push(
          `${name}: now ${bytes} bytes (< pinned ${cap}) — lower its cap to ratchet the win in`,
        );
      }
    }

    if (stale.length > 0) {
      throw new Error(`Grandfather allowlist is stale:\n${stale.join('\n')}`);
    }
  });
});

describe('selectToolsForProfile (TOOL_PROFILE)', () => {
  const allTools = (): Array<DesktopTool<any>> =>
    desktopToolFactories.map((toolFactory) => toolFactory(new DesktopMcpServer()));

  it.each(['', 'dynamic-authoring', 'demo', 'full', 'combined-lean'])(
    'keeps field listing and the repair read registered in profile "%s"',
    (profile) => {
      const names = selectToolsForProfile(allTools(), profile).map((tool) => tool.name);

      expect(names).toContain('list-available-fields');
      expect(names).toContain('get-xml');
    },
  );

  it('makes the repair read available before authoring in full and default profiles', async () => {
    const tools = allTools();
    const defaultTool = selectToolsForProfile(tools, '').find((tool) => tool.name === 'get-xml')!;
    const fullTool = selectToolsForProfile(tools, 'full').find((tool) => tool.name === 'get-xml')!;
    const extra = { ...getMockRequestHandlerExtra(), getExecutor: vi.fn() };
    type OrientationCallback = (
      args: { session?: string; kind: 'worksheet'; sheetId: string },
      callbackExtra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const defaultCallback = (await Provider.from(
      defaultTool.callback,
    )) as unknown as OrientationCallback;
    const fullCallback = (await Provider.from(fullTool.callback)) as unknown as OrientationCallback;

    const args = { session: 'S1', kind: 'worksheet' as const, sheetId: 'sheet-sales' };
    const defaultResult = await defaultCallback(args, extra);
    const fullResult = await fullCallback(args, extra);

    expect(fullResult.isError).toBe(true);
    expect(defaultResult.isError).toBe(true);
    expect(extra.getExecutor).toHaveBeenCalledTimes(2);
  });

  it('every slim-profile name is a real desktop tool name', () => {
    for (const name of DEMO_TOOL_PROFILE) {
      expect(desktopToolNames).toContain(name);
    }
  });

  it('TOOL_PROFILE=demo registers exactly the slim set (nothing more, nothing less)', () => {
    const selected = selectToolsForProfile(allTools(), 'demo');
    expect(new Set(selected.map((t) => t.name))).toEqual(DEMO_TOOL_PROFILE);
    expect(selected.map((tool) => tool.name)).toContain('run-dashboard-batch');
    expect(selected.map((tool) => tool.name)).not.toContain('dashboard-auto-apply');
    // The fallback chain used when the fast path cannot finish must survive in the demo set.
    for (const fallback of ['bind-template', 'get-xml', 'apply-workbook', 'apply-worksheet']) {
      expect(selected.map((t) => t.name)).toContain(fallback);
    }
  });

  it.each(['', 'dynamic-authoring'])(
    'TOOL_PROFILE=%j registers exactly the 74-tool modern surface with scoped XML fallbacks',
    (profile) => {
      const selected = selectToolsForProfile(allTools(), profile);
      expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
      expect(selected).toHaveLength(74);
      // The full dynamic dialect, semantically named — every author-* verb present,
      // plus the ask-for-help, diagnostics, screenshot, deterministic
      // fast-path, and the two expertise doors the system prompt's "consult the expertise library" law routes to.
      for (const verb of [
        'author-calc',
        'validate-calculated-field',
        'author-set',
        'author-parameter',
        'author-action',
        'format-worksheets',
        'format-dashboard-zones',
        'compose-story',
        'ask-user',
        'list-templates',
        'bind-template',
        'build-worksheets-from-templates',
        'refine-worksheet',
        'add-field',
        'remove-field',
        'resolve-field',
        'apply-worksheet',
        'run-dashboard-batch',
        'read-expertise-resource',
        'search-expertise',
        'get-summary-data',
        'get-sheets',
        'get-datasources',
        'apply-datasource',
        'activate-sheet',
        'delete-sheet',
        'rename-sheet',
        'sort-worksheet',
        'show-me',
        'undo-redo-workbook',
        'list-instances',
        'get-desktop-state',
        'get-app-info',
        'get-capabilities',
        'get-operations',
        'get-diagnostics',
        'get-active-dialogs',
        'invoke-dialog-action',
        'list-available-fields',
        'search-workbook-fields',
        'get-show-me-options',
        'list-worksheet-logical-tables',
        'get-worksheet-underlying-data',
        'list-datasource-logical-tables',
        'get-datasource-underlying-data',
        'capture-window-screenshot',
        'add-worksheet',
        'add-dashboard',
        'add-storyboard',
        'open-file',
        'set-start-page-visibility',
        'set-data-source-page-active',
        'save-workbook',
        'workbook-export-as',
        'close-workbook',
        'refresh-auto-updates',
        'reload-extensions',
        'get-workspace-extensions',
        'reload-workspace-extension',
        'refresh-datasource',
        'get-xml',
        'apply-workbook',
        'apply-dashboard',
        'apply-storyboard',
        'export-worksheet-image',
        'export-dashboard-image',
        'export-storyboard-image',
      ]) {
        expect(selected.map((t) => t.name)).toContain(verb);
      }
      // Keep unrelated validation tools out.
      for (const banished of [
        'validate-workbook-xml',
        'validate-worksheet-xml',
        'dashboard-auto-apply',
      ]) {
        expect(selected.map((t) => t.name)).not.toContain(banished);
      }
    },
  );

  it('exposes start-page visibility in dynamic and full surfaces, not specialized profiles', () => {
    const tools = allTools();

    expect(selectToolsForProfile(tools, '').map((tool) => tool.name)).toContain(
      'set-start-page-visibility',
    );
    expect(selectToolsForProfile(tools, 'dynamic-authoring').map((tool) => tool.name)).toContain(
      'set-start-page-visibility',
    );
    expect(selectToolsForProfile(tools, 'full').map((tool) => tool.name)).toContain(
      'set-start-page-visibility',
    );
    expect(selectToolsForProfile(tools, 'combined-lean').map((tool) => tool.name)).toContain(
      'set-start-page-visibility',
    );
    expect(selectToolsForProfile(tools, 'demo').map((tool) => tool.name)).not.toContain(
      'set-start-page-visibility',
    );
  });

  it('registers search-workbook-fields once in full and dynamic-authoring profiles', () => {
    const tools = allTools();

    expect(tools.filter((tool) => tool.name === 'search-workbook-fields')).toHaveLength(1);
    expect(DYNAMIC_AUTHORING_TOOL_PROFILE.has('search-workbook-fields')).toBe(true);
    expect(
      selectToolsForProfile(tools, 'dynamic-authoring').filter(
        (tool) => tool.name === 'search-workbook-fields',
      ),
    ).toHaveLength(1);
  });

  it('registers capture-window-screenshot once in full and dynamic-authoring profiles', () => {
    const tools = allTools();
    const captureTool = tools.find((tool) => tool.name === 'capture-window-screenshot');

    expect(captureTool).toBeDefined();
    expect(captureTool?.paramsSchema).toEqual({ session: expect.any(Object) });
    expect(captureTool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(DYNAMIC_AUTHORING_TOOL_PROFILE.has('capture-window-screenshot')).toBe(true);
    expect(
      selectToolsForProfile(tools, 'dynamic-authoring').filter(
        (tool) => tool.name === 'capture-window-screenshot',
      ),
    ).toHaveLength(1);
  });

  it('registers each dialog tool once in full and dynamic-authoring profiles', () => {
    const tools = allTools();
    const fullTools = selectToolsForProfile(tools, 'full');
    const dynamicTools = selectToolsForProfile(tools, 'dynamic-authoring');

    for (const name of ['get-active-dialogs', 'invoke-dialog-action'] as const) {
      expect(fullTools.filter((tool) => tool.name === name)).toHaveLength(1);
      expect(DYNAMIC_AUTHORING_TOOL_PROFILE.has(name)).toBe(true);
      expect(dynamicTools.filter((tool) => tool.name === name)).toHaveLength(1);
    }
  });

  it('registers refresh-auto-updates once in full and dynamic-authoring profiles', () => {
    const tools = allTools();

    expect(desktopToolNames.filter((name) => name === 'refresh-auto-updates')).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === 'refresh-auto-updates')).toHaveLength(1);
    expect(DYNAMIC_AUTHORING_TOOL_PROFILE.has('refresh-auto-updates')).toBe(true);
    expect(
      selectToolsForProfile(tools, 'dynamic-authoring').filter(
        (tool) => tool.name === 'refresh-auto-updates',
      ),
    ).toHaveLength(1);
  });

  it('unset ("") profile returns the default dynamic-authoring set', () => {
    const selected = selectToolsForProfile(allTools(), '');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
  });

  it('explicit "full" profile returns the full set unchanged', () => {
    const tools = allTools();
    expect(selectToolsForProfile(tools, 'full')).toBe(tools);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['apply-worksheet', 'run-dashboard-batch']),
    );
    expect(tools.map((tool) => tool.name)).not.toContain('dashboard-auto-apply');
  });

  it('"combined-lean" registers the full desktop set (the lean half is the web side)', () => {
    const tools = allTools();
    expect(selectToolsForProfile(tools, 'combined-lean')).toBe(tools);
  });

  it.each(['bogus', 'lean-tools'])(
    'an unknown profile value "%s" falls back to the default set and logs a warning',
    (raw) => {
      const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
      const tools = allTools();
      const selected = selectToolsForProfile(tools, raw);
      expect(selected).not.toBe(tools);
      expect(selected.map((tool) => tool.name).sort()).toEqual(
        tools
          .filter((tool) => DYNAMIC_AUTHORING_TOOL_PROFILE.has(tool.name))
          .map((tool) => tool.name)
          .sort(),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining(`"${raw}"`),
        }),
      );
      const message = String(logSpy.mock.calls.at(-1)?.[0].message);
      for (const valid of ['dynamic-authoring', 'demo', 'full', 'combined-lean']) {
        expect(message).toContain(valid);
      }
    },
  );
});

describe('API-version tool gate', () => {
  const instance = (pid: number, apiVersion?: string): ExternalApiInstance => ({
    baseUrl: `http://127.0.0.1:${pid}`,
    token: 't',
    pid,
    instanceId: `i-${pid}`,
    apiVersion,
  });

  describe('pinnedApiVersion', () => {
    it('returns the pinned instance version, not the highest', () => {
      expect(pinnedApiVersion([instance(1, '0.2.6'), instance(2, '0.2.5')], '2')).toBe('0.2.5');
    });

    it('returns undefined when the session is not pinned', () => {
      expect(pinnedApiVersion([instance(1, '0.2.6')], undefined)).toBeUndefined();
    });

    it('returns undefined when no instance matches the pinned session', () => {
      expect(pinnedApiVersion([instance(1, '0.2.6')], '999')).toBeUndefined();
    });

    it('returns undefined when no Desktop is running', () => {
      expect(pinnedApiVersion([], '1')).toBeUndefined();
    });
  });

  describe('filterToolsByApiVersion', () => {
    const tools: Array<{ name: string; minApiVersion?: string }> = [
      { name: 'a', minApiVersion: '0.2.6' },
      { name: 'b', minApiVersion: '0.2.5' },
      { name: 'c' },
    ];

    it('drops tools whose floor exceeds the connected version', () => {
      expect(filterToolsByApiVersion(tools, '0.2.5').map((t) => t.name)).toEqual(['b', 'c']);
    });

    it('keeps a tool whose floor equals the connected version', () => {
      expect(filterToolsByApiVersion(tools, '0.2.6').map((t) => t.name)).toEqual(['a', 'b', 'c']);
    });

    it('fails open when the connected version is unknown — keeps everything unchanged', () => {
      expect(filterToolsByApiVersion(tools, undefined)).toBe(tools);
    });
  });

  describe('assertServesApiVersion', () => {
    const story = { name: 'story', minApiVersion: '0.2.40' };
    const tools: Array<{ name: string; minApiVersion?: string }> = [
      story,
      { name: 'newer', minApiVersion: '0.2.38' },
      { name: 'served', minApiVersion: '0.2.34' },
      { name: 'unfloored' },
    ];

    it('throws when the Desktop is older than the floor', () => {
      expect(() => assertServesApiVersion(story, tools, '0.2.34')).toThrow(
        DesktopApiVersionTooOldError,
      );
    });

    it('names the tool and both versions', () => {
      expect(() => assertServesApiVersion(story, tools, '0.2.34')).toThrow(
        'story needs External Client API version 0.2.40 or later, but this Tableau Desktop serves 0.2.34.',
      );
    });

    it('lists every registered tool this Desktop cannot run', () => {
      expect(() => assertServesApiVersion(story, tools, '0.2.34')).toThrow(
        'Tools this Desktop cannot run: story, newer.',
      );
    });

    it('steers the agent to other tools before suggesting an update', () => {
      expect(() => assertServesApiVersion(story, tools, '0.2.34')).toThrow(
        'Do not call these tools again in this session. Continue with other tools if they can do what the user asked. ' +
          'If none can, tell the user it needs a newer Tableau Desktop.',
      );
    });

    it.each([
      ['equal to the floor', '0.2.40', '0.2.40'],
      ['newer than the floor', '0.2.40', '0.3.0'],
      ['unknown', '0.2.40', undefined],
      ['for a tool with no floor', undefined, '0.2.34'],
    ])('passes when the Desktop version is %s', (_case, minApiVersion, desktopApiVersion) => {
      const tool = { name: 'story', minApiVersion };
      expect(() => assertServesApiVersion(tool, [tool], desktopApiVersion)).not.toThrow();
    });
  });

  describe('per-call API version gate', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function callGatedTool(desktopApiVersion: string | undefined): Promise<{
      result: CallToolResult;
      toolBody: ReturnType<typeof vi.fn>;
    }> {
      const server = getServer();
      const toolBody = vi.fn();
      const tool: DesktopTool<Record<string, never>> = new DesktopTool({
        server,
        name: 'get-sheets',
        title: 'Gated',
        description: 'Gated test tool',
        paramsSchema: {},
        annotations: {
          title: 'Gated',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        minApiVersion: '0.2.40',
        callback: new Provider(
          async () =>
            async (_args, extra): Promise<CallToolResult> =>
              tool.logAndExecute({
                extra,
                args: {},
                callback: async () => {
                  await extra.getExecutor('4242');
                  toolBody();
                  return new Ok({});
                },
              }),
        ),
      });
      vi.spyOn(
        server as unknown as { _getToolsToRegister: () => unknown },
        '_getToolsToRegister',
      ).mockResolvedValue([tool]);
      vi.spyOn(SessionManager.prototype, 'getExecutor').mockResolvedValue(
        makeExecutorMock({ desktopApiVersion }),
      );
      await server.registerTools();
      const [, , registered] = vi.mocked(server.mcpServer.registerTool).mock
        .calls[0] as unknown as [
        string,
        unknown,
        (args: unknown, ctx: unknown) => Promise<CallToolResult>,
      ];
      const result = await registered(
        {},
        { mcpReq: { signal: new AbortController().signal, id: 1, notify: vi.fn() } },
      );
      return { result, toolBody };
    }

    it('rejects a call to a Desktop older than the tool floor before the tool runs', async () => {
      const { result, toolBody } = await callGatedTool('0.2.34');

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'get-sheets needs External Client API version 0.2.40 or later',
      );
      expect(toolBody).not.toHaveBeenCalled();
    });

    it.each(['0.2.40', undefined])('lets a call through to a Desktop on %s', async (version) => {
      const { result, toolBody } = await callGatedTool(version);

      expect(result.isError).toBe(false);
      expect(toolBody).toHaveBeenCalledOnce();
    });
  });

  describe('warnIfUnsupportedApiVersion', () => {
    it.each(['0.2.33', '0.1.0'])('warns for a Desktop that serves %s', (version) => {
      const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
      warnIfUnsupportedApiVersion(version);
      expect(logSpy).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining(`v${MIN_SUPPORTED_API_VERSION}`),
        }),
      );
    });

    it.each([MIN_SUPPORTED_API_VERSION, '0.2.35', '0.3.0', undefined])(
      'stays quiet for %s',
      (version) => {
        const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
        warnIfUnsupportedApiVersion(version);
        expect(logSpy).not.toHaveBeenCalled();
      },
    );
  });

  it('only sets a tool floor that is newer than the oldest supported version', () => {
    const tools = [...desktopToolFactories, ...episodeToolFactories].map((factory) =>
      factory(new DesktopMcpServer()),
    );
    const redundant = tools
      .filter(
        (tool) =>
          tool.minApiVersion !== undefined &&
          apiVersionAtLeast(MIN_SUPPORTED_API_VERSION, tool.minApiVersion),
      )
      .map((tool) => tool.name);
    expect(redundant).toEqual([]);
  });

  it('registers each individual datasource factory exactly once', () => {
    const featureNames = new Set(['get-datasources', 'apply-datasource']);
    const names = desktopToolFactories
      .map((factory) => factory(new DesktopMcpServer()).name)
      .filter((name) => featureNames.has(name));

    expect(names).toHaveLength(2);
    expect(new Set(names)).toEqual(featureNames);
  });
});

describe('DesktopMcpServer without an expertise corpus', () => {
  afterEach(() => {
    mocks.expertiseCorpusEntryCount.mockReturnValue(1);
  });

  it('withoutUnservedExpertiseTools drops only the expertise tools', () => {
    const tools = desktopToolFactories.map((factory) => factory(new DesktopMcpServer()));

    expect(withoutUnservedExpertiseTools(tools, true)).toEqual(tools);
    expect(withoutUnservedExpertiseTools(tools, false).map((tool) => tool.name)).toEqual(
      tools.map((tool) => tool.name).filter((name) => !EXPERTISE_TOOL_NAMES.has(name)),
    );
  });

  it.each(['', 'full'])(
    'registers no expertise tool for TOOL_PROFILE=%j and keeps the rest of the profile',
    async (profile) => {
      vi.stubEnv('TOOL_PROFILE', profile);
      mocks.expertiseCorpusEntryCount.mockReturnValue(0);
      const server = getServer();
      await server.registerTools();

      const registeredNames = vi
        .mocked(server.mcpServer.registerTool)
        .mock.calls.map((call) => call[0]);
      for (const name of EXPERTISE_TOOL_NAMES) {
        expect(registeredNames).not.toContain(name);
      }
      expect(registeredNames).toContain('bind-template');
      expect(registeredNames).toContain('author-calc');
    },
  );

  it('sends instructions that name no expertise tool', () => {
    mocks.expertiseCorpusEntryCount.mockReturnValue(0);
    new DesktopMcpServer();
    const [, options] = vi.mocked(McpServer).mock.calls.at(-1)!;

    expect(options?.instructions).toBe(
      buildDesktopInstructions({ sessionPinned: false, expertiseAvailable: false }),
    );
  });

  it('registers the expertise resource template only when the corpus has entries', async () => {
    const register = async (count: number): Promise<string[]> => {
      mocks.expertiseCorpusEntryCount.mockReturnValue(count);
      const server = new DesktopMcpServer();
      server.mcpServer.registerResource = vi.fn();
      await server.registerResources();
      return vi
        .mocked(server.mcpServer.registerResource)
        .mock.calls.map((call) => call[0] as string);
    };

    expect(await register(0)).toEqual(['dashboard-xml-guide']);
    expect(await register(3)).toEqual(['dashboard-xml-guide', 'tableau-expertise']);
  });
});

describe('DesktopMcpServer TOOL_PROFILE env wiring', () => {
  afterEach(() => {
    // Reset to the unset (dynamic-authoring) state so later tests in this file are unaffected.
    vi.stubEnv('TOOL_PROFILE', '');
  });

  it('registers only the slim set end-to-end when TOOL_PROFILE=demo', async () => {
    vi.stubEnv('TOOL_PROFILE', 'demo');
    const server = getServer();
    await server.registerTools();

    const registeredNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0]);
    expect(new Set(registeredNames)).toEqual(DEMO_TOOL_PROFILE);
  });

  it('registers the lean dynamic-authoring native surface when TOOL_PROFILE is unset', async () => {
    const server = getServer();
    await server.registerTools();

    const registeredNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0]);
    expect(new Set(registeredNames)).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
  });

  it('registers the full set when TOOL_PROFILE=full is explicit', async () => {
    vi.stubEnv('TOOL_PROFILE', 'full');
    const server = getServer();
    await server.registerTools();

    const registeredNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0]);
    expect(registeredNames.length).toBe(desktopToolFactories.length);
  });

  it('keeps published-site content operations out of the Desktop server even with TOOL_PROFILE=full', async () => {
    vi.stubEnv('TOOL_PROFILE', 'full');
    const server = getServer();
    await server.registerTools();

    const registeredNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0]);
    for (const webOwnedOperation of ['open-publish-workbook-dialog', 'publish-workbook']) {
      expect(registeredNames).not.toContain(webOwnedOperation);
    }
  });

  it('advertises the skills extension capability when skills-over-mcp is enabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (name: string) => name === 'skills-over-mcp',
    );
    const server = getServer();
    await server.registerTools();

    expect(server.mcpServer.server.registerCapabilities).toHaveBeenCalledWith({
      extensions: { 'io.modelcontextprotocol/skills': { directoryRead: false } },
    });
  });

  it('does not advertise the skills extension capability when skills-over-mcp is disabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(() => false);
    const server = getServer();
    await server.registerTools();

    expect(server.mcpServer.server.registerCapabilities).not.toHaveBeenCalled();
  });
});

function getServer(): DesktopMcpServer {
  const server = new DesktopMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
