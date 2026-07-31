import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { CallToolResult, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import * as configModule from './config.desktop.js';
import { sessionRouteState } from './desktop/route/route-state.js';
import {
  buildDesktopInstructions,
  SESSION_RESOLUTION_TEXT_PINNED,
  SESSION_RESOLUTION_TEXT_UNPINNED,
} from './desktop/routeTable.js';
import * as loggerModule from './logging/logger.js';
import {
  DEMO_TOOL_PROFILE,
  DESKTOP_INSTRUCTIONS,
  DesktopMcpServer,
  DYNAMIC_AUTHORING_TOOL_PROFILE,
  getDesktopToolListEntry,
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
      expect(registeredNames).toContain('desktop-read');
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
});

describe('DESKTOP_INSTRUCTIONS (generated from DESKTOP_ROUTE_TABLE)', () => {
  // Snapshot-style pin: any route-table edit must surface here as a reviewable diff.
  it('matches the pinned instructions string', () => {
    expect(DESKTOP_INSTRUCTIONS).toBe(
      `You control Tableau Desktop. Use Tableau terms: workbook/viz/sheet/field, Columns/Rows.

Before dashboards, plan MAGNITUDE vs MEMBERSHIP; MEMBERSHIP uses buckets, not gradients. State plan, build.

For any named chart type or common viz ask, including composed charts (waterfall/bridge, funnel, gantt, bullet, box plot, slope/bump, control, dual-axis, etc.), FIRST use bind-template's two-call sequence. Call 1: bind-template(auto_apply:true), deterministic, ~0.3s; pass the user's message verbatim as \`ask\` (never paraphrase, reword, or expand it). If it proposes, Call 2: bind-template with the same ask/target, selected proposal, auto_apply:true; proposals may carry sort and top_n. Do not use manual authoring tools between Call 1 and Call 2. Never call get-worksheet-xml to orient before bind-template; list-available-fields is allowed but not needed to orient: bind-template reads schema; failed binds propose candidate fields. Named charts use this first, even calc-heavy or asking "how <X> changes"; do not author template-owned calcs (including waterfall running totals) before binding. author-parameter/author-set/author-action before charts; else search-commands.

For a clear derived-metric ask with no named chart type (margin %, ratio/rate/per, growth/change %), FIRST pass its conventional calc in ONE bind-template(auto_apply:true) call via calcs[], binding its caption (for example, gross margin % = (SUM(Revenue)-SUM(COGS))/SUM(Revenue); a proposal still resolves via Call 2). Only after a formula/field-resolution failure, search-knowledge, then make ONE corrective bind-template call.

For an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design) only when no plain-chart binding path applies; a named chart type always takes plain-chart first, even with calc/formatting riders; chart-route escalation may still consult, FIRST search-knowledge; use read-knowledge-resource to read the top hit once, then proceed.

For a dashboard ask with 2-6 vizzes, build sheets with bind-template (author calcs/params/sets first), then compose with dashboard-auto-apply (2-6 plain charts, one call) or plan-dashboard-creation -> build-and-apply-dashboard; search-commands only for commands the census does not list.

For a data-value question, on a populated worksheet, call get-summary-data; answer only from returned rows.

For a dynamic ask or a calc/derived field the data lacks WITHOUT a conventional name (a named ratio/margin/growth ask routes via calc-then-bind; examples here include running total and LOD), use author-* verbs: author-parameter FIRST (on { reopened: true } continue immediately), then author-set, author-calc, author-action, format-labels. Build with bind-template and authored captions.

If ambiguity changes workbook content, call ask-user with urgency=blocking; stop.

For current/existing sheet/chart/view/dashboard, edit in place: resolve target (exact name else desktop-read method:worksheets/dashboards; ask-user if ambiguous), then refine-worksheet for top-N/sort ONLY, add-field + apply-worksheet for a color/size/detail or rows/cols field, or an author-* tool; a NEW chart here = bind-template with target_worksheet. Never create new sheets unless asked.

Command census: activate-sheet switches sheets; author-* tools author semantics; refine-worksheet edits top-N/sort; add-field + apply-worksheet change encodings. Use search-commands ONLY for unlisted commands.

Omit session for one Desktop; use list-instances when multiple are open.

If preflight rejects apply, fix per FIX lines. Prefer file mode

If NO native tool covers the asked shape, say so plainly — never invent or hand-author XML. get-worksheet-xml -> add-field -> apply-worksheet is sanctioned. Whole-workbook XML surgery is behind TOOL_PROFILE=full, which the user can enable.`,
    );
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

describe('desktop tools/list serialized surface', () => {
  it('keeps the served dynamic authoring profile under the tool-search auto-deferral threshold budget', async () => {
    const server = new DesktopMcpServer();
    const tools = desktopToolFactories.map((toolFactory) => toolFactory(server));
    const dynamicAuthoringTools = selectToolsForProfile(tools, 'dynamic-authoring');
    let dynamicAuthoringTotal = DESKTOP_INSTRUCTIONS.length;
    let fullSurfaceTotal = DESKTOP_INSTRUCTIONS.length;

    for (const tool of tools) {
      const bytes = (await serializeDesktopToolSurface(tool)).length;
      fullSurfaceTotal += bytes;
      if (DYNAMIC_AUTHORING_TOOL_PROFILE.has(tool.name)) {
        dynamicAuthoringTotal += bytes;
      }
    }
    expect(new Set(dynamicAuthoringTools.map((tool) => tool.name))).toEqual(
      DYNAMIC_AUTHORING_TOOL_PROFILE,
    );

    // Dynamic authoring is the serving surface, so this is the real budget gate, and it
    // stays well under the 46k tools/list cliff (the dedicated served-surface test below
    // guards that invariant). The full desktop surface is opt-in (TOOL_PROFILE=full), not
    // what clients see by default; its looser cap only catches runaway growth without
    // forcing valuable full-profile tools to be trimmed.
    // Honest wire measurements are 28,186 bytes dynamic and 41,059 bytes full: both dropped
    // when the environment reads AND the five thin workbook/datasource reads folded into the
    // one desktop-read dispatcher (served on the dynamic profile). The dynamic cap ratchets
    // BELOW its long-standing 29,479 as a result.
    // Keep only a few bytes of ratchet headroom on each cap.
    expect(dynamicAuthoringTotal).toBeLessThanOrEqual(28_193);
    expect(fullSurfaceTotal).toBeLessThanOrEqual(41_066);
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
    ['bind-template', 2463], // raised with sign-off (2026-07-27, #643 review fold): calcs[]/auto_apply describes + datatype/role enums for the one-call derived-metric path — the same undescribed-param class that cost 299 repeat binds (2,562s) in shipped v10; restoring gutted descriptions was refused as funding
    ['add-field', 1435], // provenance-style describes (from field resolution, never invented)
    ['inject-template', 1404], // provenance-style describes; session also made optional
    ['refine-worksheet', 1464], // raised for omitted-targetField axis detection; funded by a ~500-byte same-tool describe trim
    ['plan-dashboard-creation', 1383], // ratcheted down in the author-set/action/format-labels funding trim (CODA, empty describe stubs); do not grow
    ['build-and-apply-dashboard', 1430], // ratcheted down in the CODA funding trim; do not grow
    ['validate-proposal', 1510], // ratcheted down with compact shared proposal descriptions; 46k stays green
    // The template parameter is a z.enum over the real template vocabulary, so its cost
    // is the vocabulary itself, not prose. Agents invented 13 template ids against 47
    // real ones and burned 188s discovering it; the enum makes that unrepresentable.
    // Trim by retiring templates, not by re-opening the parameter to a free string.
    ['build-and-apply-worksheet', 1786],
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
    'keeps field listing and the gated repair read registered in profile "%s"',
    (profile) => {
      const names = selectToolsForProfile(allTools(), profile).map((tool) => tool.name);

      expect(names).toContain('list-available-fields');
      expect(names).toContain('get-worksheet-xml');
    },
  );

  it('gates the full-profile repair read identically to the default profile', async () => {
    sessionRouteState.clear();
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

    expect(fullResult).toEqual(defaultResult);
    expect(fullResult.isError).toBe(false);
    expect(extra.getExecutor).not.toHaveBeenCalled();
  });

  it('every slim-profile name is a real desktop tool name', () => {
    for (const name of DEMO_TOOL_PROFILE) {
      expect(desktopToolNames).toContain(name);
    }
  });

  it('TOOL_PROFILE=demo registers exactly the slim set (nothing more, nothing less)', () => {
    const selected = selectToolsForProfile(allTools(), 'demo');
    expect(new Set(selected.map((t) => t.name))).toEqual(DEMO_TOOL_PROFILE);
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

  it('TOOL_PROFILE=dynamic-authoring registers exactly the 29-tool data-first singable surface — native authoring + the grouped desktop-read + atomic sheet activation + the manual path read/edit legs, no workbook round-trip/validation XML tools', () => {
    const selected = selectToolsForProfile(allTools(), 'dynamic-authoring');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
    expect(selected).toHaveLength(29);
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
      'bind-template',
      'refine-worksheet',
      'add-field',
      'remove-field',
      'resolve-field',
      'apply-worksheet',
      'build-and-apply-worksheet',
      'dashboard-auto-apply',
      'plan-dashboard-creation',
      'batch-create-and-cache-sheets',
      'build-and-apply-dashboard',
      'read-knowledge-resource',
      'search-knowledge',
      'get-summary-data',
      // The grouped read: worksheets/dashboards lists, workbook inventory, workbook/site
      // datasources, and the environment reads all reach the agent through this one tool.
      'desktop-read',
      'activate-sheet',
      // The manual field-edit path's read leg — mints the worksheetFile add-field/
      // remove-field/apply-worksheet consume.
      'get-worksheet-xml',
    ]) {
      expect(selected.map((t) => t.name)).toContain(verb);
    }
    // Zero agent-visible WHOLE-WORKBOOK round-trip/validation XML tools: the hand-XML
    // surgery surface stays OUT, including get-workbook-xml + apply-workbook. Navigation gets
    // only the dedicated atomic activate-sheet fallback. The per-sheet lane is in:
    // get-worksheet-xml reads, read-cached-xml/write-cached-xml edit the cached slice, and
    // apply-worksheet applies the file — apply-* takes no document, so this lane is the route.
    // The thin read tools folded into desktop-read no longer exist as standalone tools.
    for (const banished of [
      'get-workbook-xml',
      'apply-workbook',
      'validate-workbook-xml',
      'validate-worksheet-xml',
      'inject-template',
      'list-templates',
      'get-app-info',
      'list-knowledge-resources',
    ]) {
      expect(selected.map((t) => t.name)).not.toContain(banished);
    }
  });

  it('dynamic-authoring surface sits well under the 46k tools/list cliff (the whole point of a lean profile)', async () => {
    const server = new DesktopMcpServer();
    const selected = selectToolsForProfile(
      desktopToolFactories.map((f) => f(server)),
      'dynamic-authoring',
    );
    let total = DESKTOP_INSTRUCTIONS.length;
    for (const tool of selected) {
      total += (await serializeDesktopToolSurface(tool)).length;
    }
    // A lean surface must have generous headroom — this is a structural win, not a
    // describe-stub squeeze. If this ever approaches 46k something is very wrong.
    // Ratcheted down when the thin reads folded into desktop-read.
    expect(total).toBeLessThanOrEqual(28_193);
  });

  it('unset ("") profile returns the lean dynamic-authoring native surface — the singer sings native by default', () => {
    const selected = selectToolsForProfile(allTools(), '');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
  });

  it('explicit "full" profile returns the full set unchanged', () => {
    const tools = allTools();
    expect(selectToolsForProfile(tools, 'full')).toBe(tools);
    expect(tools.map((tool) => tool.name)).toContain('list-knowledge-resources');
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

describe('DesktopMcpServer TOOL_PROFILE env wiring', () => {
  afterEach(() => {
    // Reset to the unset (full) state so later tests in this file are unaffected.
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
