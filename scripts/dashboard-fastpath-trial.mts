/*
 * W60-DASHBOARD-FASTPATH — feasibility + timing trial.
 *
 * Goal: "build me a sales dashboard" → 3 stamped charts + one composed dashboard,
 * measured end-to-end, sub-60s wall.
 *
 * Path exercised (all against the LIVE Desktop over the LEGACY transport via
 * build/index.desktop.js on stdio — TABLEAU_EXTERNAL_API is intentionally NOT set):
 *   Leg 1-3:  bind-template({ auto_apply:true }) × 3  → 3 stamped worksheets, one MCP call each
 *   Leg 4:    batch-create-and-cache-sheets({ worksheetNames:[], dashboardName })
 *               → creates ONLY the empty dashboard placeholder (+ caches workbook/dashboard XML).
 *               NB: worksheetNames MUST be [] — the 3 chart sheets already exist; addSheet
 *               throws on a name collision, so re-declaring them would abort the leg.
 *   Leg 5:    build-and-apply-dashboard({ layoutSpec, worksheetNames })
 *               → injects viewpoints + lays out zones referencing the 3 sheets, applies.
 * Then: verify (list-worksheets / list-dashboards / get-dashboard-xml) and RESTORE the anchor
 * fixture ×2 via apply-workbook, with a worksheet-list readback.
 *
 * Run:  node_modules/.bin/tsx scripts/dashboard-fastpath-trial.mts
 * Env:  TMCP_SESSION (default: auto — prefer 77568, else the single running instance)
 */
import { Client } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const REPO = '/Users/mattfilbert/OpenSource/tableau-mcp-authoring';
const FIXTURE =
  '/Users/mattfilbert/OpenSource/agent-to-tableau-desktop/tests/fixtures/superstore-scratch-ref.xml';
const DASHBOARD_TITLE = 'Sales Dashboard';

const transport = new StdioClientTransport({
  command: 'node',
  args: [`${REPO}/build/index.desktop.js`],
});
const client = new Client({ name: 'w60-dashboard-fastpath', version: '0.0.1' });
await client.connect(transport);

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean };
const text = (r: ToolResult): string =>
  (r.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');

type Json = Record<string, unknown> | null;
type Leg = { ms: number; text: string; isError: boolean; json: Json };
const call = async (name: string, args: Record<string, unknown>): Promise<Leg> => {
  const t0 = performance.now();
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  const t = text(r);
  let json: Json = null;
  try {
    json = JSON.parse(t);
  } catch {
    /* non-JSON text result */
  }
  return { ms: Math.round(performance.now() - t0), text: t, isError: !!r.isError, json };
};

const firstPath = (s: string): string | undefined => (s.match(/(\/[^\s"']+\.xml)/) || [])[1];

// ── Resolve session ────────────────────────────────────────────────────────
let session = process.env.TMCP_SESSION;
const inst = await call('list-instances', {});
const instances = (inst.json?.instances ?? []) as Array<{ sessionId?: unknown; pid?: unknown }>;
if (!session) {
  const preferred = instances.find(
    (i) => String(i.sessionId) === '77568' || String(i.pid) === '77568',
  );
  session = preferred
    ? String(preferred.sessionId ?? preferred.pid)
    : instances[0]
      ? String(instances[0].sessionId ?? instances[0].pid)
      : '77568';
}
console.log(
  `# instances: ${instances.map((i) => i.sessionId ?? i.pid).join(', ') || '(none reported)'} — using session=${session}`,
);

const baseline = await call('list-worksheets', { session });
console.log(`# baseline worksheets: ${JSON.stringify(baseline.json?.worksheets ?? baseline.text)}`);

// ── Legs 1-3: bind + auto_apply ─────────────────────────────────────────────
const asks = [
  { label: 'bar', ask: 'bar chart of Sales by Sub-Category' },
  { label: 'line', ask: 'line chart of Sales by Order Date' },
  { label: 'waterfall', ask: 'waterfall of Profit by Sub-Category' },
];

const summary: { legs: unknown[]; [k: string]: unknown } = { session, legs: [] };
const sheetNames: string[] = [];

const wallStart = performance.now();

for (const a of asks) {
  const bind = await call('bind-template', { session, ask: a.ask, auto_apply: true });
  const j = bind.json ?? {};
  const applied = j.applied === true;
  const sheet = j.sheet_name;
  if (applied && typeof sheet === 'string') sheetNames.push(sheet);
  summary.legs.push({
    leg: `bind:${a.label}`,
    ask: a.ask,
    clientMs: bind.ms,
    isError: bind.isError,
    status: j.status,
    used_llm: j.used_llm,
    applied,
    sheet_name: sheet,
    phase_ms: j.phase_ms,
    apply_error: j.apply_error,
  });
  console.log(
    `bind:${a.label.padEnd(9)} client=${String(bind.ms).padStart(5)}ms status=${j.status} used_llm=${j.used_llm} applied=${applied} sheet=${JSON.stringify(sheet)} phase_ms=${JSON.stringify(j.phase_ms)}${j.apply_error ? ` apply_error=${j.apply_error}` : ''}`,
  );
}

// ── Leg 4: create the empty dashboard placeholder (worksheets already exist) ──
let dashboardName = DASHBOARD_TITLE;
let batch = await call('batch-create-and-cache-sheets', {
  session,
  worksheetNames: [],
  dashboardName,
});
if (batch.isError && /already exists/i.test(batch.text)) {
  dashboardName = `${DASHBOARD_TITLE} (${Date.now()})`;
  batch = await call('batch-create-and-cache-sheets', {
    session,
    worksheetNames: [],
    dashboardName,
  });
}
const workbookFile = batch.json?.workbookFile ?? firstPath(batch.text);
const dashboardFile = batch.json?.dashboardFile ?? firstPath(batch.text);
summary.legs.push({
  leg: 'batch-create-and-cache-sheets',
  dashboardName,
  clientMs: batch.ms,
  isError: batch.isError,
  workbookFile,
  dashboardFile,
});
console.log(
  `batch                client=${String(batch.ms).padStart(5)}ms isError=${batch.isError} dashboardFile=${dashboardFile} workbookFile=${workbookFile}`,
);

// ── Leg 5: compose the dashboard (viewpoints + zone layout) ──────────────────
const layoutSpec = {
  kpis: [] as string[],
  charts: sheetNames,
  layoutType: 'auto-grid' as const,
  gridColumns: 2,
};
const build = await call('build-and-apply-dashboard', {
  session,
  dashboardName,
  dashboardFile,
  workbookFile,
  title: DASHBOARD_TITLE,
  layoutSpec,
  worksheetNames: sheetNames,
});
summary.legs.push({
  leg: 'build-and-apply-dashboard',
  clientMs: build.ms,
  isError: build.isError,
  result: build.json ?? build.text.slice(0, 300),
});
console.log(
  `build-and-apply      client=${String(build.ms).padStart(5)}ms isError=${build.isError} ${build.isError ? build.text.slice(0, 240) : JSON.stringify(build.json)}`,
);

const fastpathWallMs = Math.round(performance.now() - wallStart);
summary.fastpathWallMs = fastpathWallMs;
summary.sheetNames = sheetNames;
summary.dashboardName = dashboardName;
console.log(
  `\n=== FASTPATH WALL (3 binds + batch + compose): ${fastpathWallMs}ms (${(fastpathWallMs / 1000).toFixed(1)}s) ===\n`,
);

// ── Verify ───────────────────────────────────────────────────────────────────
const afterSheets = await call('list-worksheets', { session });
const afterDashboards = await call('list-dashboards', { session });
const dashXml = await call('get-dashboard-xml', { session, dashboardName, mode: 'inline' });
const dashboardXml: string = dashXml.json?.dashboardXml ?? dashXml.text;
const refs = sheetNames.map((n) => ({ sheet: n, referenced: dashboardXml.includes(n) }));
summary.verify = {
  worksheets: afterSheets.json?.worksheets,
  worksheetCount: afterSheets.json?.count,
  dashboards: afterDashboards.json,
  dashboardXmlBytes: dashboardXml.length,
  sheetRefsInDashboardXml: refs,
};
console.log(`# after worksheets: ${JSON.stringify(afterSheets.json?.worksheets)}`);
console.log(`# after dashboards: ${afterDashboards.text.slice(0, 240)}`);
console.log(`# dashboard references sheets: ${JSON.stringify(refs)}`);

// ── Restore anchor: apply fixture ×2 (restore discipline) ────────────────────
const restore1 = await call('apply-workbook', { session, mode: 'file', workbookFile: FIXTURE });
const restore2 = await call('apply-workbook', { session, mode: 'file', workbookFile: FIXTURE });
const readback = await call('list-worksheets', { session });
summary.restore = {
  apply1: { ms: restore1.ms, isError: restore1.isError },
  apply2: { ms: restore2.ms, isError: restore2.isError },
  readbackWorksheets: readback.json?.worksheets,
  readbackCount: readback.json?.count,
};
console.log(
  `\n# RESTORE apply#1=${restore1.ms}ms(err=${restore1.isError}) apply#2=${restore2.ms}ms(err=${restore2.isError}) readback=${JSON.stringify(readback.json?.worksheets)}`,
);

console.log('\n=== SUMMARY JSON ===');
console.log(JSON.stringify(summary, null, 2));

await client.close();
process.exit(0);
