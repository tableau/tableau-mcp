import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

import * as configModule from './config.desktop.js';
import * as loggerModule from './logging/logger.js';
import {
  DEMO_TOOL_PROFILE,
  DESKTOP_INSTRUCTIONS,
  DesktopMcpServer,
  DYNAMIC_AUTHORING_TOOL_PROFILE,
  selectToolsForProfile,
  SPEC_LOOP_TOOL_PROFILE,
} from './server.desktop.js';
import { DesktopTool } from './tools/desktop/tool.js';
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
    const tools = allTools.filter(
      (tool, i) => !disabledFlags[i] && tool.name !== 'check-for-user-changes',
    );
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

  it('does not register check-for-user-changes on the External Client API transport', async () => {
    const server = getServer();
    await server.registerTools();

    const registeredNames = (
      vi.mocked(server.mcpServer.registerTool).mock.calls as Array<[string, ...unknown[]]>
    ).map(([name]) => name);
    expect(registeredNames).not.toContain('check-for-user-changes');
    expect(registeredNames).toContain('list-worksheets');
  });

  it('does not register list-instances when a Desktop session is pinned', async () => {
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
      expect(registeredNames).not.toContain('list-instances');
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
});

describe('DESKTOP_INSTRUCTIONS (generated from DESKTOP_ROUTE_TABLE)', () => {
  // Snapshot-style pin: any route-table edit must surface here as a reviewable diff.
  it('matches the pinned instructions string', () => {
    expect(DESKTOP_INSTRUCTIONS).toBe(
      `You control Tableau Desktop. Use Tableau terms: workbook/viz/sheet/field, Columns/Rows.

Load tableau-desktop-authoring; repeat failures -> tableau-agent-debug.

Before dashboards, plan MAGNITUDE vs MEMBERSHIP; MEMBERSHIP uses buckets, not gradients. State plan, build.

For an unfamiliar or non-trivial authoring ask (calc-heavy, uncertain which chart fits, formatting/design) — never a plain chart ask the plain-chart route already handles, FIRST search-knowledge; use read-knowledge-resource to read the top hit once, then proceed.

For a plain viz ask (bar/line/map/KPI/etc.), FIRST bind-template(auto_apply:true): deterministic, ~0.3s. On propose, resubmit; proposals may carry sort and top_n. author-parameter/author-set/author-action before charts; else search-commands.

For a dashboard ask with 2-6 vizzes, build sheets with bind-template (author calcs/params/sets first), then compose with dashboard-auto-apply (2-6 plain charts, one call) or plan-dashboard-creation -> build-and-apply-dashboard; search-commands only for commands the census does not list.

For a data-value question, on a populated worksheet, call get-summary-data; answer only from returned rows. A terminal/no-data result means stop; a transient failure may be retried once.

For a dynamic ask or a calc/derived field the data lacks (ratio, running total, LOD), use author-* verbs: author-parameter FIRST (on { reopened: true } continue immediately), then author-set, author-calc, author-action, format-labels. Build with bind-template and authored captions.

If ambiguity changes workbook content, call ask-user with urgency=blocking; stop.

For current/existing sheet/chart/view/dashboard, edit in place: resolve target (exact name else list-worksheets/list-dashboards; ask-user if ambiguous), then refine-worksheet for top-N/sort or author-* tool; a NEW chart on the current sheet = bind-template with target_worksheet. Never create new sheets unless asked.

Command census: tabdoc:goto-sheet switches sheets; author-* tools author semantics; refine-worksheet edits top-N/sort. Use search-commands ONLY for unlisted commands.

Omit session for one Desktop; use list-instances when multiple are open.

If preflight rejects apply, fix per FIX lines. Prefer file mode`,
    );
  });

  it('tells agents to narrate with Tableau vocabulary', () => {
    expect(DESKTOP_INSTRUCTIONS).toContain('Use Tableau terms: workbook/viz/sheet/field');
  });
});

/**
 * Serialize a single desktop tool's tools/list entry exactly as the sum-budget
 * test below does, so the per-tool accounting numbers reconcile against the sum
 * (Σ per-tool bytes + DESKTOP_INSTRUCTIONS.length === the sum test's total).
 */
async function serializeDesktopToolSurface(tool: DesktopTool<any>): Promise<string> {
  const paramsSchema = await Provider.from(tool.paramsSchema);
  const obj = normalizeObjectSchema(paramsSchema as any);
  const inputSchema = obj
    ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' } as any)
    : { type: 'object', properties: {} };

  return JSON.stringify({
    name: tool.name,
    title: await Provider.from(tool.title),
    description: await Provider.from(tool.description),
    inputSchema,
    annotations: await Provider.from(tool.annotations),
    execution: { taskSupport: 'forbidden' },
  });
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

    // Dynamic authoring is the serving surface, so this is the real budget gate.
    // The full desktop surface is not what clients see by default; its looser cap
    // only catches runaway growth without forcing valuable full-profile tools to be trimmed.
    expect(dynamicAuthoringTotal).toBeLessThanOrEqual(30_000);
    expect(fullSurfaceTotal).toBeLessThanOrEqual(52_000);
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
  const PER_TOOL_BUDGET = 1_200;

  // Tools already over PER_TOOL_BUDGET at this base (feature/authoring @ 241a67e7).
  // Each value is the tool's CURRENT serialized size — a ceiling, NOT a target.
  // DO NOT GROW these: trim them down and lower/remove the entry. Never raise a
  // cap, and never add a new entry to dodge the budget without explicit sign-off.
  const GRANDFATHERED: ReadonlyMap<string, number> = new Map([
    ['bind-template', 2030], // raised for target_worksheet (e1/s7 stray-sheet fix); funded by describe trims, total stays under the 46k cliff
    ['plan-dashboard-creation', 1509], // ratcheted down in the author-set/action/format-labels funding trim (CODA, empty describe stubs); do not grow
    ['build-and-apply-dashboard', 1558], // ratcheted down in the CODA funding trim; do not grow
    ['validate-proposal', 1533], // raised for the same shared sort/top_n proposal schema; 46k stays green
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

  it('TOOL_PROFILE=spec-loop registers exactly the ruthless 5-tool set — no XML tools, no templates', () => {
    const selected = selectToolsForProfile(allTools(), 'spec-loop');
    expect(new Set(selected.map((t) => t.name))).toEqual(SPEC_LOOP_TOOL_PROFILE);
    // The whole point: the XML/template surface must be GONE.
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

  it('TOOL_PROFILE=dynamic-authoring registers exactly the 31-tool data-first singable surface — native authoring + workbook reads + atomic sheet activation, no workbook round-trip/cache/validation XML tools', () => {
    const selected = selectToolsForProfile(allTools(), 'dynamic-authoring');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
    expect(selected).toHaveLength(31);
    // The full dynamic dialect, semantically named — every author-* verb present,
    // plus the ask-for-help, command-discovery, deterministic fast-path, and the three
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
      'list-knowledge-resources',
      'read-knowledge-resource',
      'search-knowledge',
      'get-summary-data',
      'get-workbook-inventory',
      'list-workbook-datasources',
      'list-site-datasources',
      'activate-sheet',
    ]) {
      expect(selected.map((t) => t.name)).toContain(verb);
    }
    // Zero agent-visible workbook round-trip/cache/validation XML tools: the full hand-XML
    // surgery surface stays OUT, including get-workbook-xml + apply-workbook. Navigation gets
    // only the dedicated atomic activate-sheet fallback.
    for (const banished of [
      'get-workbook-xml',
      'apply-workbook',
      'get-worksheet-xml',
      'read-cached-xml',
      'write-cached-xml',
      'validate-workbook-xml',
      'validate-worksheet-xml',
      'inject-template',
      'list-templates',
      'list-site-workbooks',
      'get-app-info',
      'get-health',
      'get-worksheet-info',
      'list-storyboards',
      'get-storyboard-xml',
      'get-api-root',
      'get-site-info',
      'get-dashboard-info',
      'get-storyboard-info',
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
    // A 10-tool surface must have generous headroom — this is a structural win, not a
    // describe-stub squeeze. If this ever approaches 46k something is very wrong.
    expect(total).toBeLessThanOrEqual(30_000);
  });

  it('unset ("") profile returns the lean dynamic-authoring native surface — the singer sings native by default', () => {
    const selected = selectToolsForProfile(allTools(), '');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
  });

  it('explicit "full" profile returns the full set unchanged', () => {
    const tools = allTools();
    expect(selectToolsForProfile(tools, 'full')).toBe(tools);
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
    expect(registeredNames.length).toBe(desktopToolFactories.length - 1);
    expect(registeredNames).not.toContain('check-for-user-changes');
  });
});

function getServer(): DesktopMcpServer {
  const server = new DesktopMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
