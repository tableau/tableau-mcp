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
    const tools = allTools.filter((_, i) => !disabledFlags[i]);
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
    const base = configModule.getDesktopConfig();
    const spy = vi
      .spyOn(configModule, 'getDesktopConfig')
      .mockReturnValue({ ...base, externalApiEnabled: true });

    try {
      const server = getServer();
      await server.registerTools();

      const registeredNames = (
        vi.mocked(server.mcpServer.registerTool).mock.calls as Array<[string, ...unknown[]]>
      ).map(([name]) => name);
      expect(registeredNames).not.toContain('check-for-user-changes');
      expect(registeredNames).toContain('list-worksheets');
    } finally {
      spy.mockRestore();
    }
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
      `You are controlling Tableau Desktop. Use Tableau vocabulary in your narration: say workbook, viz, sheet, or field rather than implementation formats; shelf names are Columns and Rows. Use product data type names like Number (whole), Number (decimal), Text, and True/False.

Load tableau-desktop-authoring before builds/edits; if unresolved failures repeat, switch to tableau-agent-debug, not manual XML.

Before multi-viz/dashboard builds, plan: classify requirements as MAGNITUDE=continuous quantity or MEMBERSHIP=discrete group; encode MEMBERSHIP with discrete buckets, never raw-measure color gradients. State the one-line plan, then build.

For a plain viz ask (bar/line/map/KPI/etc.), FIRST bind-template(auto_apply:true): deterministic, ~0.3s, no model work. On propose, resubmit; proposals may carry sort and top_n. calcs[] inline; author-parameter, author-set, author-action first; else search-commands.

For a dashboard ask with 2-6 vizzes (e.g. "a dashboard with sales by region and profit by category"), build each sheet with bind-template (author calcs, parameters, and sets first with the author-* verbs when the sheet needs them), then compose the dashboard — search-commands only for commands the census does not list.

For a data-value question ("what was revenue in Q3?"), do NOT answer with a number — this server cannot read data values. Say so, then offer the viz that would show it (a plain viz ask via bind-template) instead.

For a DYNAMIC ask — a parameter the user drives, computed top/bottom-N membership, click-to-change interaction, or mark labels — or a calc/derived field the data lacks (ratio, running total, LOD), use the author-* verbs, never raw commands or XML. Author parameters FIRST via author-parameter (it reopens Desktop and re-pins the session itself; on { reopened: true } continue immediately; stagePath optional). Then author-set for param-linked top/bottom-N membership (count accepts '[Parameters].[Parameter N]'), author-calc for calcs, author-action for click-to-param wiring, format-labels for labels. Build the charts around them with bind-template asks naming the authored captions.

If ambiguity changes workbook content, call ask-user with urgency=blocking; stop for answer.

For current/this/that/existing sheet, chart, view, or dashboard, edit in place: resolve the target (exact name, else list-worksheets or list-dashboards; ask via ask-user if ambiguous), then refine-worksheet for top-N/sort edits or the relevant author-* tool. Never create a new sheet unless explicitly asked.

Command census: tabdoc:goto-sheet switches sheets; author-calc, author-set, author-parameter, author-action, format-labels author semantic objects; refine-worksheet handles top-N and sort edits on an existing sheet. Use search-commands ONLY for commands not listed here.

Omit session when exactly one Desktop instance runs; use list-instances when multiple are open.

If an apply is rejected by preflight validation, fix the workbook content per the FIX lines in the error and re-apply. Prefer file mode for large workbooks.`,
    );
  });

  it('tells agents to narrate with Tableau vocabulary', () => {
    expect(DESKTOP_INSTRUCTIONS).toContain(
      'Use Tableau vocabulary in your narration: say workbook, viz, sheet, or field rather than implementation formats; shelf names are Columns and Rows.',
    );
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
  it('stays under the tool-search auto-deferral threshold budget', async () => {
    const server = new DesktopMcpServer();
    let total = DESKTOP_INSTRUCTIONS.length;

    for (const toolFactory of desktopToolFactories) {
      total += (await serializeDesktopToolSurface(toolFactory(server))).length;
    }

    // 46_000 is the ToolSearch auto-deferral cliff on MCP hosts, not a tunable constant — past it
    // the whole desktop surface gets deferred behind ToolSearch. The shelf-tool consolidation has
    // landed, so this is GREEN: the serialized surface is 45_202 bytes, ~798 under the cliff.
    // That headroom is the ENTIRE budget for future tools — trim tools to fit it; NEVER raise the
    // cap to ship a tool (raising it just re-buries the whole surface behind ToolSearch).
    expect(total).toBeLessThanOrEqual(46_000);
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
    ['bind-template', 1886], // raised for shared sort/top_n proposal vocab; combined-lean 46k stays green
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

  it('TOOL_PROFILE=dynamic-authoring registers exactly the 14-tool singable surface — the spec-loop 5 + the author-* 5 + ask-user + search-commands + bind-template + refine-worksheet, no XML/cache tools', () => {
    const selected = selectToolsForProfile(allTools(), 'dynamic-authoring');
    expect(new Set(selected.map((t) => t.name))).toEqual(DYNAMIC_AUTHORING_TOOL_PROFILE);
    expect(selected).toHaveLength(14);
    // The full dynamic dialect, semantically named — every author-* verb present,
    // plus the ask-for-help, command-discovery, and deterministic fast-path doors.
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
    ]) {
      expect(selected.map((t) => t.name)).toContain(verb);
    }
    // Zero agent-visible XML/cache/validation tools.
    for (const banished of [
      'get-workbook-xml',
      'apply-workbook',
      'get-worksheet-xml',
      'apply-worksheet',
      'read-cached-xml',
      'write-cached-xml',
      'validate-workbook-xml',
      'validate-worksheet-xml',
      'inject-template',
      'list-templates',
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
    expect(registeredNames.length).toBe(desktopToolFactories.length);
  });
});

function getServer(): DesktopMcpServer {
  const server = new DesktopMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}
