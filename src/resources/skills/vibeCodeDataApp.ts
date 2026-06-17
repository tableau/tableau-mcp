/**
 * Skill content for vibe-coding a Tableau data app that is packaged as a
 * Dashboard Extension and hosted by Tableau.
 *
 * Authored as markdown but stored as a TS module string so it bundles into the
 * esbuild output with no asset-copy step and is importable from tests.
 *
 * Exposed to MCP clients as a resource (see `src/resources/index.ts`).
 */
export const VIBE_CODE_DATA_APP_SKILL_NAME = 'vibe-code-data-app';
export const VIBE_CODE_DATA_APP_SKILL_URI = 'skill://vibe-code-data-app';

export const vibeCodeDataAppSkill = `# Skill: Vibe-Code a Tableau Data App

You are generating a **data app** that will be packaged as a **Tableau Dashboard
Extension** (a \`.trex\` manifest plus a hosted web bundle) and loaded inside a
Tableau workbook. The app is "hosted by Tableau" and runs in a sandboxed iframe
on a dashboard.

Follow these rules whenever a user asks you to build a Tableau data app,
visualization, or dashboard extension through this MCP server. Read this skill
before generating any app code.

---

## 1. Do not hardcode data unless strictly needed

The whole point of a Tableau data app (vs. a throwaway LLM artifact) is that the
data is **live, governed, and fresh**. Do not inline rows, JSON, CSV, sample
arrays, or "mock" datasets anywhere in the app unless it is impossible to fetch or derive the data using tableau query services and calcs.

All data SHOULD be fetched at runtime through the data-access shim:

\`\`\`js
// Returns { columns: [...], rows: [...] } — see section 4 for the shape.
const result = await window.tableauData.query({
  datasourceLuid: '<published-datasource-luid>', // optional; defaults to first datasource resource
  query: { /* VizQL Data Service query — see section 4 */ },
});
\`\`\`

If you catch yourself writing a literal data array, stop and replace it with a
\`window.tableauData\` call.

---

## 2. What you are building (packaging awareness)

The \`scaffold-data-app\` tool generates the project skeleton. Fill it in; do not
restructure it. Expected layout:

\`\`\`
<app-dir>/
  index.html          # entry point; loads the Extensions API + the shim + your app
  manifest.trex       # Dashboard Extension manifest (URL finalized at deploy time)
  dataapp.json        # the resource list (provided — package/deploy read it)
  server.js           # the Tableau data proxy (provided — do not rewrite)
  src/
    config.js         # inlines the resource list for the browser (provided)
    tableauData.js    # the data-access shim (provided — do not rewrite)
    app.(js|jsx|ts|tsx)  # YOUR app code goes here
    styles.css
\`\`\`

Rules:
- Keep everything self-contained and relatively-pathed so the bundle works from
  any host origin.
- Do not add a build step that the package tool cannot run. Prefer a single
  entry module. If you use React, use it via an ESM CDN import or the bundler
  the scaffold sets up — do not assume a custom toolchain.
- Do not hardcode the host URL anywhere. The shim's endpoint is injected at
  deploy time.

### Placing and inspecting code (works without local filesystem access)

The scaffold also writes an \`AGENTS.md\` contract into the project. If you have
direct filesystem access (e.g. a local coding agent), edit \`src/app.js\` natively.
If you do NOT (e.g. a sandboxed web-chat agent talking to a local MCP server), use
these tools to close the loop entirely through the server:

- \`write-data-app-file\` — place generated code (e.g. \`src/app.js\`). Paths are
  constrained to the app directory; the shim, \`server.js\`, and \`dataapp.json\` are
  protected (pass \`allowProtected: true\` only if you truly must touch plumbing).
- \`read-data-app-file\` — read a file back to verify what is on disk.
- \`list-data-app-files\` — list the project's files + sizes (use it to confirm the
  bundle before packaging/deploying, or to debug a failed deploy).

Do NOT fall back to pasting code for a human to save — that breaks the deploy
(it commits whatever is on disk). Always write via \`write-data-app-file\` first.

---

## 3. Resources: the app can be wired to many, of mixed types

An app is NOT limited to one data source. \`scaffold-data-app\` accepts an
arbitrary array of typed Tableau resources, so a single app can combine several
data sources, views, workbooks, and Pulse metrics. Pass them like:

\`\`\`jsonc
// scaffold-data-app args
{
  "appName": "TMCP Weekly Pulse",
  "resources": [
    { "name": "hbiUsage",  "type": "datasource", "luid": "..." },
    { "name": "tmcpUsage", "type": "datasource", "luid": "..." },
    { "name": "userAgent", "type": "view",       "luid": "..." },
    { "name": "hbiReqs",   "type": "metric",     "luid": "..." }
  ]
}
\`\`\`

(\`datasourceLuid\` is still accepted as a shortcut for a single datasource.)

At runtime, discover what the app is wired to:

\`\`\`js
window.tableauData.resources           // [{ name, type, luid }, ...]
window.tableauData.byName('hbiUsage')  // the resource with that name
\`\`\`

Use the method that matches each resource type (all return \`{ columns, rows }\`
except where noted). When you omit a LUID, the first configured resource of that
type is used.

| Resource type | Method | Notes |
| --- | --- | --- |
| \`datasource\` | \`window.tableauData.query({ datasourceLuid?, query, limit? })\` | Arbitrary VizQL Data Service query (preferred — full field/agg/filter freedom). |
| \`view\` | \`window.tableauData.getViewData({ viewLuid?, maxRows? })\` | Summary data of a published view as rows. |
| \`workbook\` | \`window.tableauData.getWorkbookViews({ workbookLuid? })\` | Returns \`{ views: [{ id, name, contentUrl }] }\`; drill into each via \`getViewData\`. |
| \`metric\` | \`window.tableauData.getMetrics({ metricLuids? })\` | Returns \`{ metrics: [...] }\` (Pulse metric specs / metadata only). |
| \`metric\` | \`window.tableauData.getMetricValues({ metricLuids? })\` | Returns \`{ metrics: [{ metric_id, name, value: { formatted_value, characterization } }] }\` — the current Pulse value for KPI cards. Requires Pulse insights enabled. |

Prefer \`datasource\` + \`query\` when you need full control over fields,
aggregations, and filters; use \`view\`/\`workbook\` to mirror an existing viz, and
\`metric\` to surface Pulse definitions.

---

## 4. Data contract: the \`window.tableauData.query\` shim

\`query\` is the richest data path. It forwards a VizQL Data Service (VDS) query to
the Tableau-hosted proxy and returns rows. The app stays credential-free.

Input:
\`\`\`ts
window.tableauData.query({
  datasourceLuid?: string,         // optional; defaults to the first datasource resource
  query: {
    fields: Array<{
      fieldCaption: string,        // the field's caption in the data source
      function?: 'SUM' | 'AVG' | 'COUNT' | 'COUNTD' | 'MIN' | 'MAX' | 'MEDIAN',
      sortDirection?: 'ASC' | 'DESC',
      sortPriority?: number,
      // for dimensions, omit function; for measures, set function
    }>,
    filters?: Array<object>,       // VDS filter objects (quantitative/date/set/match)
  },
  limit?: number,
}): Promise<{ columns: string[], rows: Array<Record<string, unknown>> }>
\`\`\`

Guidance:
- Query exactly the fields you render — let VDS aggregate server-side instead of
  pulling raw rows and aggregating in the browser.
- Discover the available fields and their captions first (the agent can call the
  \`get-datasource-metadata\` MCP tool) per datasource resource. Never guess field names.
- Metadata lists more fields than VDS will actually accept (calc fields, joined
  columns can return "Unknown Field"). When unsure, confirm a caption is queryable
  by running a tiny one-field \`query-datasource\` against it before committing to it.
- Treat every query as potentially slow or empty; render loading and empty states.
- Handle errors: the shim rejects with a message on failure — surface it,
  do not silently fall back to fake data. On a VDS error the proxy adds an
  \`actionable\` hint to the response body when it recognizes the failure shape.

> Note: in this prototype the proxy runs queries as a single service identity, so
> row-level security reflects that identity, not the individual viewer. Do not
> design around per-viewer identity yet.

---

## 5. Definition of done

Before handing off to \`package-data-app\`:
- [ ] Your code is actually written to disk (via \`write-data-app-file\` or a native
      edit) — confirm with \`list-data-app-files\` if you lack filesystem access.
- [ ] \`tableau.extensions.initializeAsync()\` is awaited before rendering.
- [ ] Dashboard filters/parameters are read and applied where relevant.
- [ ] Loading, empty, and error states are handled.
- [ ] Field captions used in queries were verified against datasource metadata.
- [ ] Title, takeaway, formatting, and caveats follow the style contract.

After \`deploy-data-app\`: it health-checks the live app and lists the shipped
files. If the health check fails or an expected file is missing, fix the bundle
(\`write-data-app-file\`), re-verify with \`list-data-app-files\`, and redeploy —
don't assume the deploy worked just because it printed a URL.
`;
