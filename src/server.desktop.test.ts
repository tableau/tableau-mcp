import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import {
  CallToolResult,
  ListToolsRequestSchema,
  Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';

import * as configModule from './config.desktop.js';
import * as episodeEvents from './desktop/episode-events.js';
import { ExternalApiInstance } from './desktop/externalApi/types.js';
import {
  buildDesktopInstructions,
  SESSION_RESOLUTION_TEXT_PINNED,
  SESSION_RESOLUTION_TEXT_UNPINNED,
} from './desktop/instructions.js';
import * as loggerModule from './logging/logger.js';
import {
  DEMO_TOOL_PROFILE,
  DESKTOP_INSTRUCTIONS,
  DesktopMcpServer,
  DYNAMIC_AUTHORING_TOOL_PROFILE,
  filterToolsByApiVersion,
  getDesktopToolListEntry,
  resolveConnectedApiVersion,
  selectToolsForProfile,
  SPEC_LOOP_TOOL_PROFILE,
} from './server.desktop.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { getMockRequestHandlerExtra } from './tools/desktop/toolContext.mock.js';
import { desktopToolNames } from './tools/desktop/toolName.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { Provider } from './utils/provider.js';

describe('DesktopMcpServer', () => {
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
          inputSchema: await Provider.from(tool.paramsSchema),
          annotations: await Provider.from(tool.annotations),
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
      expect(registeredNames).toContain('list-worksheets');
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
    const listToolsCall = setRequestHandler.mock.calls.find(
      ([requestSchema]) => requestSchema === ListToolsRequestSchema,
    );
    expect(listToolsCall).toBeDefined();

    const result = await listToolsCall![1]({} as never, {} as never);
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
    const sharedMcpServer = new McpServer({ name: 'shared', version: '0.0.0' });
    const server = new DesktopMcpServer({ mcpServer: sharedMcpServer });
    await server.registerTools();

    expect(server.ownsMcpServer).toBe(false);
    const listToolsCall = vi
      .mocked(sharedMcpServer.server.setRequestHandler)
      .mock.calls.find(([requestSchema]) => requestSchema === ListToolsRequestSchema);
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
      });

      await server.registerTools();
      const listToolsCall = vi
        .mocked(server.mcpServer.server.setRequestHandler)
        .mock.calls.find(([requestSchema]) => requestSchema === ListToolsRequestSchema);
      const listResult = await listToolsCall![1]({} as never, {} as never);
      const listedTools = (listResult as { tools: McpTool[] }).tools;

      expect(emitSpy).toHaveBeenCalledWith(expect.anything(), {
        type: 'tool_schemas_registered',
        surface: 'desktop',
        profile: 'unknown',
        tool_count: listedTools.length,
        schemas_json_chars: JSON.stringify(listedTools).length,
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
      buildDesktopInstructions({ sessionPinned: false, profile: '' }),
    );
    expect(DESKTOP_INSTRUCTIONS).toContain('build-worksheets-from-templates');
    expect(DESKTOP_INSTRUCTIONS).toContain('bind-template');
    expect(DESKTOP_INSTRUCTIONS).toContain('auto_apply:true');
  });

  it('tells agents to narrate with Tableau vocabulary', () => {
    expect(DESKTOP_INSTRUCTIONS).toContain('Use Tableau terms: workbook/viz/sheet/field');
  });

  it('keeps pin-aware session guidance (list-instances, target another) when pinned', () => {
    const pinned = buildDesktopInstructions({ sessionPinned: true });
    expect(pinned).toContain(SESSION_RESOLUTION_TEXT_PINNED);
    expect(pinned).toContain('list-instances');
    expect(pinned).not.toContain(SESSION_RESOLUTION_TEXT_UNPINNED);
  });
});

/**
 * Serialize a single desktop tool's tools/list entry exactly as the sum-budget
 * test below does, so the per-tool accounting numbers reconcile against the sum
 * (Σ per-tool bytes + DESKTOP_INSTRUCTIONS.length === the sum test's total).
 */
async function serializeDesktopToolSurface(tool: DesktopTool<any>): Promise<string> {
  return JSON.stringify(await getDesktopToolListEntry(tool));
}

// Re-pinned 2026-08-10: added pause-auto-updates and resume-auto-updates over the External
// Client API per-sheet auto-update routes — both in DYNAMIC_AUTHORING_TOOL_PROFILE, so the
// served surface moves 29_380 -> 30_627 and the full surface 49_076 -> 50_323.
// Raised 2026-08-10 (#734 review fold) 48_958 -> 49_076: bind-template gained
// skip_validation, the server-gated trust flag for the deterministic build_viz path.
// It is a genuinely new param (name + boolean schema, description dropped since the
// LLM must never set it), so shrinking prose could not fund it. At that historical point,
// bind-template was not in DYNAMIC_AUTHORING_TOOL_PROFILE, so #734 did not move that ratchet.
// Re-pinned 2026-08-07: added delete-sheet, rename-sheet, sort-worksheet,
// list-worksheet-logical-tables, and get-worksheet-underlying-data over the External
// Client API sheet-action and logical-table routes, and dropped delete-worksheet.
// Re-pinned 2026-08-10: apply-worksheet gained the direct templatePlan mode so an
// explicit single-view request can build+apply in one call without widening the tool set.
// The combined surface moves 30_627 -> 31_485; full moves 50_323 -> 51_101.
// Re-pinned 2026-08-11: added open-file, save-workbook, add-worksheet, add-dashboard, and
// add-storyboard over the External Client API 0.2.6 routes, with open-file/save-workbook
// descriptions carrying the new-window/session-binding and blocking-Save-As caveats the 0.2.6
// descriptions spell out. All five join the dynamic-authoring profile: served moves
// 31_485 -> 34_581 (still well under the 46k cliff), full moves 51_101 -> 54_197.
// Re-pinned 2026-08-14: the fallback/apply work plus list-worksheets/list-dashboards/list-storyboards
// returning each item's full External Client API payload (hidden, index, active sheet, auto-updates,
// datasources/contained sheets). Retain the established 18-character ratchet slack.
// Re-pinned 2026-08-17: added export-storyboard-image over the External Client API storyboard
// image route, mirroring export-worksheet-image and export-dashboard-image. Like those two it
// stays out of DYNAMIC_AUTHORING_TOOL_PROFILE, so those ratchets are unchanged; full moves
// 54_759 -> 55_656 (surface 54_741 -> 55_638, +897 for the tool, retaining the 18-char slack).
// Its description states the deliberate V0 scope — only the active story point renders; other
// points are not included and cannot be selected.
// Re-pinned 2026-08-18: added workbook-export-as over the External Client API workbook:exportAs
// route (pdf/powerpoint/packaged-workbook/prior-version, headless write to filePath), gated to a
// 0.2.7 minApiVersion floor (the gate is server-side metadata, not serialized surface). Unlike the
// image exports it joins DYNAMIC_AUTHORING_TOOL_PROFILE, so it moves both surfaces by +1012:
// dynamic authoring 39_069 -> 40_081 (budget 39_087 -> 40_099, keeping the 18-char slack), full
// surface 55_638 -> 56_650 (budget 55_656 -> 56_668).
// Re-pinned 2026-08-19: list-templates now exposes derived template-fit metadata and filters by
// required visible channels. Its schema adds 149 bytes; tighter route prose removes 131 from the
// served profile, while the full schema-only surface moves 56_650 -> 56_799.
// Re-pinned 2026-08-19: added native Custom Theme apply, inspect, and export tools to the Desktop
// authoring suite. The later apply-worksheet name inference trims three bytes from both profiles.
// Dynamic stays below the 46k product ceiling with 18 bytes of ratchet slack.
// Re-pinned 2026-08-19: workbook-bound theme apply adds the required target fingerprint input;
// both profiles move by 95 bytes; dynamic keeps 18 bytes and full keeps 36 bytes of ratchet slack.
// Re-pinned 2026-08-19: apply-worksheet now infers the target from a cached worksheet fragment, so
// its worksheetName describe drops the redundant "worksheet" (-3 bytes); dynamic authoring 40_099 -> 40_096.
// Re-pinned 2026-08-19: surfaced type/isExtract/hasDownloadFilePermission on
// list-workbook-datasources (+89 on its description), and added publish-workbook,
// refresh-datasource-data, and refresh-datasource-extract over the External Client API 0.2.8
// routes, gated to a 0.2.8 floor. All three join DYNAMIC_AUTHORING_TOOL_PROFILE, so dynamic
// authoring moves 40_096 -> 42_521 (budget kept at the 18-char slack) and the full surface
// 56_799 -> 59_224. Dynamic still clears the 46k cliff.
// Re-pinned 2026-08-20: get-app-info's description now also documents the live UI-state fields
// (Start Page visibility, Data Source page active, presentation mode) added to /v0/app in External
// Client API 0.2.9. get-app-info is outside DYNAMIC_AUTHORING_TOOL_PROFILE, so only the full surface
// moves: 59_224 -> 59_313 (retaining the 18-char slack).
// Re-pinned 2026-08-21: search-workbook-fields (#797) and dropping list-site-datasources
// (#815) land together. Dynamic authoring 42_521 -> 42_739 (net of both changes, budget
// kept at the 18-char slack) and the full surface 59_313 -> 60_064 (search-workbook-fields
// only; list-site-datasources stays on the full profile).
// Re-pinned 2026-08-21: get-summary-data is a clean API wrapper; its description drops the
// terminal/retry prose (-60 bytes), so dynamic authoring moves 42_739 -> 42_679 and the full
// surface 60_064 -> 60_004, retaining the 18-character slack.
// Re-pinned 2026-08-21: bind-template joins the current 54-tool base as the bounded fast path
// for recognizable single-view asks. The 55-tool surface is 45_742 bytes; retain the current
// 18-character ratchet slack without raising the 46k product ceiling.
// Re-pinned 2026-08-21 (merge of dev/myu404 in-place author-parameter into feature/desktop):
// author-parameter now edits the live document in place — its obsolete stagePath param leaves the
// schema (-30 bytes) and it adopts the sibling `datasource` selector param (+31 bytes) for a net
// +1; dynamic authoring 45_742 -> 45_743 (18-char slack kept, 46k product ceiling untouched).
// Re-pinned 2026-08-21: executive-summary adds KPI names to run-dashboard-batch while trimming its
// older field prose; dynamic authoring 45_743 -> 45_758 without raising the 46k product ceiling.
// Re-pinned 2026-08-21: mark KPI names as ordered; 45_758 -> 45_761 consumes the existing slack
// without raising either budget.
// Re-pinned 2026-08-21: native Custom Theme support and named blank-sheet routing join the merged
// surface. Retain 18 bytes of ratchet slack under the temporary 48k ceiling while TAS keeps SDK
// tool search disabled for Summit reliability.
// Re-pinned 2026-08-22: author-set gains a condition (rule-based) set mode — the
// 'condition' mode enum value plus the conditionExpression param add +52 bytes; dynamic authoring
// 47_525 -> 47_577 (18-byte ratchet slack kept, well under the temporary 48k product ceiling).
// Re-pinned 2026-08-24: the executive dashboard route carries live-sheet apply, KPI order/naming,
// deterministic layout, recovery, computed-sort, and pre-composition Top-N rules; the artifact
// fallback accepts the same Top-N bound, and run-dashboard-batch describes its chart/KPI roles.
// Dynamic is 49_136 and full is 61_997; keep 18 bytes of slack under the tool-search-era 50k ceiling.
const DYNAMIC_AUTHORING_SURFACE_EXPECTED = 49_136;
const DYNAMIC_AUTHORING_SURFACE_BUDGET = 49_154;
const DYNAMIC_AUTHORING_PRODUCT_CEILING = 50_000;
const FULL_TOOL_SURFACE_BUDGET = 62_015;

describe('desktop tools/list serialized surface', () => {
  it('keeps the served dynamic authoring profile under the tool-search auto-deferral threshold budget', async () => {
    const server = new DesktopMcpServer();
    const tools = desktopToolFactories.map((toolFactory) => toolFactory(server));
    const dynamicAuthoringTools = selectToolsForProfile(tools, 'dynamic-authoring');
    let dynamicAuthoringTotal = DESKTOP_INSTRUCTIONS.length;
    let fullToolSurfaceTotal = 0;

    for (const tool of tools) {
      const bytes = (await serializeDesktopToolSurface(tool)).length;
      fullToolSurfaceTotal += bytes;
      if (DYNAMIC_AUTHORING_TOOL_PROFILE.has(tool.name)) {
        dynamicAuthoringTotal += bytes;
      }
    }
    expect(new Set(dynamicAuthoringTools.map((tool) => tool.name))).toEqual(
      DYNAMIC_AUTHORING_TOOL_PROFILE,
    );

    // The default served surface includes instructions. Full-profile tool schemas are
    // pinned separately so intentional route prose does not fund schema growth.
    // Re-pinned 2026-08-10: explicit single-view writes use apply-worksheet.templatePlan;
    // preview/no-change requests retain the read-only artifact path.
    expect(DESKTOP_INSTRUCTIONS).toHaveLength(5_414);
    expect(dynamicAuthoringTotal).toBe(DYNAMIC_AUTHORING_SURFACE_EXPECTED);
    expect(dynamicAuthoringTotal).toBeLessThanOrEqual(DYNAMIC_AUTHORING_SURFACE_BUDGET);
    expect(dynamicAuthoringTotal).toBeLessThanOrEqual(DYNAMIC_AUTHORING_PRODUCT_CEILING);
    expect(fullToolSurfaceTotal).toBeLessThanOrEqual(FULL_TOOL_SURFACE_BUDGET);
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
    const paramsSchema = await Provider.from(tool.paramsSchema);
    const obj = normalizeObjectSchema(paramsSchema as any);
    const inputSchema = obj
      ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' } as any)
      : { type: 'object', properties: {} };
    collectSchemaDescriptions(inputSchema);
  }

  return values;
}

describe('desktop tools/list Tableau vocabulary', () => {
  it('does not expose XML in tool titles, descriptions, or parameter descriptions', async () => {
    const offenders = (await collectDesktopToolVocabularySurface())
      .filter((value) => /\bxml\b/i.test(value))
      .sort();

    expect(offenders).toEqual([]);
  });
});

describe('desktop tools/list per-tool byte accounting', () => {
  // Per-tool ceiling. The sum test above pins the SURFACE; this pins ATTRIBUTION:
  // when the sum reddens it names WHICH tool got fat, with numbers. Kept well
  // under the sum's slack so a single tool can't silently eat the whole budget.
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
    ['bind-template', 2575], // ratcheted 2026-08-21 after combining the dynamic fast path with the calc datasource selector; compact parameter prose preserves the route without raising the cap
    ['add-field', 1396], // ratcheted down 2026-08-12: worksheetName/worksheetFile describes trimmed to fund the sticky edit-buffer nudge while staying under budget
    ['inject-template', 1229], // ratcheted down 2026-08-06 after removing the fork-only output mode; session remains optional
    ['apply-worksheet', 1579], // ratcheted down 2026-08-19: worksheetName inferred from a cached fragment, describe drops the redundant "worksheet"; earlier ratchet 2026-08-12 trimming the worksheetName describe to id-or-name; earlier raise 2026-08-10: direct templatePlan folds an exact single-view build into the existing guarded apply tool; no new tool surface
    ['refine-worksheet', 1465], // raised with sign-off (2026-08-05): agreed UI-label title 'Refining worksheet'; earlier raise for omitted-targetField axis detection, funded by a ~500-byte same-tool describe trim
    ['build-worksheets-from-templates', 1150], // raised 2026-08-24: explicit Top-N artifact input keeps ranked executive views bounded before composition
    ['run-dashboard-batch', 1278], // raised 2026-08-24: tool and schema state staged apply, live chart order, layout roles, and KPI display order
    ['plan-dashboard-creation', 1378], // ratcheted down in the author-set/action/format-labels funding trim (CODA, empty describe stubs); do not grow
    ['build-and-apply-dashboard', 1423], // ratcheted down in the CODA funding trim; do not grow
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

describe('selectToolsForProfile (TOOL_PROFILE, W60 spike lever 1 / preamble P1)', () => {
  const allTools = (): Array<DesktopTool<any>> =>
    desktopToolFactories.map((toolFactory) => toolFactory(new DesktopMcpServer()));

  it.each(['', 'dynamic-authoring', 'demo', 'spec-loop', 'full', 'combined-lean'])(
    'keeps field listing and the repair read registered in profile "%s"',
    (profile) => {
      const names = selectToolsForProfile(allTools(), profile).map((tool) => tool.name);

      expect(names).toContain('list-available-fields');
      expect(names).toContain('get-worksheet-xml');
    },
  );

  it('makes the repair read available before authoring in full and default profiles', async () => {
    const tools = allTools();
    const defaultTool = selectToolsForProfile(tools, '').find(
      (tool) => tool.name === 'get-worksheet-xml',
    )!;
    const fullTool = selectToolsForProfile(tools, 'full').find(
      (tool) => tool.name === 'get-worksheet-xml',
    )!;
    const extra = { ...getMockRequestHandlerExtra(), getExecutor: vi.fn() };
    type OrientationCallback = (
      args: { session?: string },
      callbackExtra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const defaultCallback = (await Provider.from(
      defaultTool.callback,
    )) as unknown as OrientationCallback;
    const fullCallback = (await Provider.from(fullTool.callback)) as unknown as OrientationCallback;

    const defaultResult = await defaultCallback({ session: 'S1' }, extra);
    const fullResult = await fullCallback({ session: 'S1' }, extra);

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
    // The escalation-fallback chain the preamble-hunt requires must survive the slim.
    for (const fallback of [
      'bind-template',
      'get-workbook-xml',
      'inject-template',
      'apply-workbook',
      'apply-worksheet',
    ]) {
      expect(selected.map((t) => t.name)).toContain(fallback);
    }
  });

  it('every spec-loop-profile name is a real desktop tool name', () => {
    for (const name of SPEC_LOOP_TOOL_PROFILE) {
      expect(desktopToolNames).toContain(name);
    }
  });

  it('TOOL_PROFILE=spec-loop registers exactly the 6-tool set — command loop plus gated repair read', () => {
    const selected = selectToolsForProfile(allTools(), 'spec-loop');
    expect(new Set(selected.map((t) => t.name))).toEqual(SPEC_LOOP_TOOL_PROFILE);
    // XML authoring and template tools remain absent; the universal gated
    // get-worksheet-xml repair read is asserted by the profile-wide test above.
    for (const banished of [
      'get-workbook-xml',
      'apply-workbook',
      'apply-worksheet',
      'inject-template',
      'bind-template',
      'batch-create-and-cache-sheets',
    ]) {
      expect(selected.map((t) => t.name)).not.toContain(banished);
    }
    // execute-tableau-command is the one load-bearing tool — it must survive.
    expect(selected.map((t) => t.name)).toContain('execute-tableau-command');
  });

  it('TOOL_PROFILE=dynamic-authoring registers exactly the 58-tool modern surface with scoped XML fallbacks', () => {
    const selected = selectToolsForProfile(allTools(), 'dynamic-authoring');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
    expect(selected).toHaveLength(58);
    // The full dynamic dialect, semantically named — every author-* verb present,
    // plus the ask-for-help, command-discovery, deterministic fast-path, and the two
    // knowledge doors the system prompt's "consult the expertise library" law routes to.
    for (const verb of [
      'author-calc',
      'author-set',
      'author-parameter',
      'author-action',
      'format-labels',
      'ask-user',
      'search-commands',
      'list-templates',
      'bind-template',
      'build-worksheets-from-templates',
      'refine-worksheet',
      'add-field',
      'remove-field',
      'resolve-field',
      'apply-worksheet',
      'run-dashboard-batch',
      'read-knowledge-resource',
      'search-knowledge',
      'get-summary-data',
      'get-workbook-inventory',
      'list-workbook-datasources',
      'activate-sheet',
      'delete-sheet',
      'rename-sheet',
      'sort-worksheet',
      'undo-workbook',
      'redo-workbook',
      'list-instances',
      'list-available-fields',
      'search-workbook-fields',
      'list-worksheets',
      'list-dashboards',
      'list-worksheet-logical-tables',
      'get-worksheet-underlying-data',
      'add-worksheet',
      'add-dashboard',
      'add-storyboard',
      'open-file',
      'save-workbook',
      'workbook-export-as',
      'publish-workbook',
      'refresh-datasource-data',
      'refresh-datasource-extract',
      'get-workbook-xml',
      'apply-workbook',
      'apply-workbook-style',
      'inspect-custom-theme',
      'export-custom-theme',
      'get-dashboard-xml',
      'apply-dashboard',
      'get-storyboard-xml',
      'apply-storyboard',
      // The manual field-edit path's read leg — mints the worksheetFile add-field/
      // remove-field/apply-worksheet consume.
      'get-worksheet-xml',
    ]) {
      expect(selected.map((t) => t.name)).toContain(verb);
    }
    // Keep unrelated info/site/validation and legacy template tools out. The six scoped and
    // whole-workbook fallbacks above are the complete XML surface added to this profile.
    for (const banished of [
      'build-and-apply-worksheet',
      'validate-workbook-xml',
      'validate-worksheet-xml',
      'inject-template',
      'list-site-datasources',
      'list-site-workbooks',
      'get-app-info',
      'get-health',
      'get-worksheet-info',
      'list-storyboards',
      'get-api-root',
      'get-site-info',
      'get-dashboard-info',
      'get-storyboard-info',
      'list-knowledge-resources',
      'plan-dashboard-creation',
      'batch-create-and-cache-sheets',
      'build-and-apply-dashboard',
      'compose-dashboard',
      'dashboard-auto-apply',
    ]) {
      expect(selected.map((t) => t.name)).not.toContain(banished);
    }
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

  it('dynamic-authoring surface stays under its explicit tools/list ceiling', async () => {
    const server = new DesktopMcpServer();
    const selected = selectToolsForProfile(
      desktopToolFactories.map((f) => f(server)),
      'dynamic-authoring',
    );
    let total = DESKTOP_INSTRUCTIONS.length;
    for (const tool of selected) {
      total += (await serializeDesktopToolSurface(tool)).length;
    }
    expect(total).toBe(DYNAMIC_AUTHORING_SURFACE_EXPECTED);
    expect(total).toBeLessThanOrEqual(DYNAMIC_AUTHORING_SURFACE_BUDGET);
    expect(total).toBeLessThanOrEqual(DYNAMIC_AUTHORING_PRODUCT_CEILING);
  });

  it('unset ("") profile returns the lean dynamic-authoring native surface — the singer sings native by default', () => {
    const selected = selectToolsForProfile(allTools(), '');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
  });

  it('explicit "full" profile returns the full set unchanged', () => {
    const tools = allTools();
    expect(selectToolsForProfile(tools, 'full')).toBe(tools);
    expect(tools.map((tool) => tool.name)).toContain('list-knowledge-resources');
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'apply-worksheet',
        'compose-dashboard',
        'plan-dashboard-creation',
        'batch-create-and-cache-sheets',
        'build-and-apply-dashboard',
        'run-dashboard-batch',
      ]),
    );
    expect(tools.map((tool) => tool.name)).not.toContain('dashboard-auto-apply');
  });

  it('"combined-lean" registers the full desktop set (the lean half is the web side)', () => {
    const tools = allTools();
    expect(selectToolsForProfile(tools, 'combined-lean')).toBe(tools);
  });

  it('an unknown profile value falls back to the full set and logs a warning', () => {
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    const tools = allTools();
    const selected = selectToolsForProfile(tools, 'bogus');
    expect(selected).toBe(tools);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
  });
});

describe('API-version tool gate (interim minApiVersion floor)', () => {
  const instance = (pid: number, apiVersion?: string): ExternalApiInstance => ({
    baseUrl: `http://127.0.0.1:${pid}`,
    token: 't',
    pid,
    instanceId: `i-${pid}`,
    apiVersion,
  });

  describe('resolveConnectedApiVersion', () => {
    it('unpinned → the highest version across live instances, not the newest-started', () => {
      // Discovery is newest-first, so instances[0] here is the LOWER-version build; the gate
      // must still resolve 0.2.6 so a tool the other running Desktop serves is not hidden.
      expect(
        resolveConnectedApiVersion([instance(1, '0.2.5'), instance(2, '0.2.6')], undefined),
      ).toBe('0.2.6');
    });

    it('unpinned → ignores instances with an unknown version when others report one', () => {
      expect(resolveConnectedApiVersion([instance(1), instance(2, '0.2.6')], undefined)).toBe(
        '0.2.6',
      );
    });

    it('unpinned → undefined when no instance reports a version', () => {
      expect(resolveConnectedApiVersion([instance(1), instance(2)], undefined)).toBeUndefined();
    });

    it('pinned → the matching instance version, not the highest', () => {
      expect(resolveConnectedApiVersion([instance(1, '0.2.6'), instance(2, '0.2.5')], '2')).toBe(
        '0.2.5',
      );
    });

    it('pinned but no match → undefined so the gate fails open', () => {
      expect(resolveConnectedApiVersion([instance(1, '0.2.6')], '999')).toBeUndefined();
    });

    it('no instances → undefined', () => {
      expect(resolveConnectedApiVersion([], undefined)).toBeUndefined();
      expect(resolveConnectedApiVersion([], '1')).toBeUndefined();
    });

    it('unpinned mixed-version fleet → a tool only the newer instance serves stays visible', () => {
      const version = resolveConnectedApiVersion(
        [instance(1, '0.2.6'), instance(2, '0.2.7')],
        undefined,
      );
      const tools = [{ name: 'story', minApiVersion: '0.2.7' }, { name: 'plain' }];
      expect(filterToolsByApiVersion(tools, version).map((t) => t.name)).toEqual([
        'story',
        'plain',
      ]);
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

  it('the version-gated tools declare the expected floors', () => {
    const floors = new Map(
      desktopToolFactories
        .map((factory) => factory(new DesktopMcpServer()))
        .map((tool) => [tool.name, tool.minApiVersion]),
    );
    expect(floors.get('pause-auto-updates')).toBe('0.2.5');
    expect(floors.get('resume-auto-updates')).toBe('0.2.5');
    expect(floors.get('open-file')).toBe('0.2.6');
    expect(floors.get('save-workbook')).toBe('0.2.6');
    expect(floors.get('add-worksheet')).toBe('0.2.6');
    expect(floors.get('add-dashboard')).toBe('0.2.6');
    expect(floors.get('add-storyboard')).toBe('0.2.6');
    expect(floors.get('export-storyboard-image')).toBe('0.2.7');
    expect(floors.get('workbook-export-as')).toBe('0.2.7');
    expect(floors.get('publish-workbook')).toBe('0.2.8');
    expect(floors.get('refresh-datasource-data')).toBe('0.2.8');
    expect(floors.get('refresh-datasource-extract')).toBe('0.2.8');
  });

  it('a connected 0.2.5 Desktop hides only the 0.2.6 tools from the profile surface', () => {
    const profileTools = selectToolsForProfile(
      desktopToolFactories.map((factory) => factory(new DesktopMcpServer())),
      'dynamic-authoring',
    );
    const gated = filterToolsByApiVersion(profileTools, '0.2.5').map((tool) => tool.name);

    for (const dropped of [
      'open-file',
      'save-workbook',
      'add-worksheet',
      'add-dashboard',
      'add-storyboard',
    ]) {
      expect(gated).not.toContain(dropped);
    }
    for (const kept of ['pause-auto-updates', 'resume-auto-updates', 'apply-worksheet']) {
      expect(gated).toContain(kept);
    }
  });

  it('a connected 0.2.6 Desktop still hides the 0.2.7 export routes', () => {
    const fullTools = selectToolsForProfile(
      desktopToolFactories.map((factory) => factory(new DesktopMcpServer())),
      'full',
    );
    const at26 = filterToolsByApiVersion(fullTools, '0.2.6').map((tool) => tool.name);
    const at27 = filterToolsByApiVersion(fullTools, '0.2.7').map((tool) => tool.name);

    for (const route of ['export-storyboard-image', 'workbook-export-as']) {
      expect(at26).not.toContain(route);
      expect(at27).toContain(route);
    }
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
});

function getServer(): DesktopMcpServer {
  const server = new DesktopMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
