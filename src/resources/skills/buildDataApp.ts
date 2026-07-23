// The canonical, server-side source of truth for the "build a data app" workflow. Served as the
// MCP resource `skill://tableau/build-data-app` (see buildDataAppResource.ts). Any client-specific
// adapter (e.g. the .claude skill) should point here rather than duplicating this guidance.
export const buildDataAppSkill = `# Build a Data App

## What this is

A workflow for turning a business question into a small, self-contained Tableau **data app** — a
bundled dashboard extension that queries a **published Tableau datasource live** — and, when the user
wants it, publishing that app to their Tableau site.

This workflow assumes you are starting from a **known published datasource** (you have, or can find,
its LUID). Decide what the user is trying to see, then wire the app to that datasource and author the
query + visualization against it.

## Live-query model (read this first)

**The data app queries its datasource live via the Tableau Extensions API — there is NO embedded data
snapshot.** The shipped app calls \`readMetadataAsync()\` / \`queryAsync()\` at view time against the
published datasource, so it always reflects current data. Three things follow from this, and all
three are handled for you by the tools — do not fight them:

1. **Results are wrapped.** \`queryAsync\`/\`readMetadataAsync\` return \`{ payload: "<json string>" }\`,
   not \`{ data: [...] }\`. Always unwrap: \`JSON.parse(result.payload).data\`. The scaffold's
   \`extractData()\` helper already does this — use it.
2. **The datasource must be on the dashboard.** A dashboard extension can only see datasources used
   by a worksheet on its own dashboard. \`scaffold-data-app\` wires a tiny invisible "zombie"
   worksheet onto the dashboard for exactly this reason — you do not create it yourself.
3. **You cannot run the live query yourself.** A live query only executes inside the Tableau host, so
   you cannot see real rows until the app is published and opened in Tableau. Introspect with the
   datasource tools while authoring; do the visual review in Tableau **after** publishing.

## 1. Detect intent

Build a data app when:
- The user asks to "chart", "visualize", "build a dashboard", or "publish this to Tableau".
- There is a published datasource whose data a small live app would clearly help the user explore.

Skip it when:
- The answer is a single-value lookup or a text answer and the user has not signaled interest in a
  reusable visual.

## 2. Identify the published datasource(s)

Find the target published datasource and its LUID (use the datasource discovery tools if the user has
not named one). The app is wired to this datasource up front. You can wire more than one datasource
if the app genuinely needs them.

## 3. Scaffold the workspace with the datasource(s)

Call \`scaffold-data-app\` with the \`datasources\` (LUIDs). It creates the workspace, wires the
workbook to those datasources (the zombie worksheet), and writes a live boot skeleton
(\`index.html\`, \`src/app.js\`, \`src/styles.css\`). It does NOT write your query or visualization —
that is your job in the next step. It does not embed any data.

## 4. Introspect the datasource, then author the app

Use the Tableau metadata/query tools (for example \`get-datasource-metadata\` and
\`query-datasource\`) to understand the datasource's fields, then author \`src/app.js\` with
\`upsert-data-app-files\`:
- Build a VDS query (fields + optional filters/aggregations) and call \`ds.queryAsync(query)\`.
- Unwrap the result with the provided \`extractData()\` helper.
- Render with **safe DOM APIs** (\`textContent\` / \`createElement\`) — never \`innerHTML\` with live
  values (the data is untrusted and this prevents XSS).
- On error, render an explicit "Live query unavailable: <reason>" state — there is no static
  fallback.

Never invent field names or data shapes; trace every field you query to a metadata/query tool result.
There is no required file layout, chart count, or palette — a good app clearly answers the question.

## 5. Validate the final workspace

Validate the workspace with \`validate-workbook-package\` before offering to publish. It packages the
workspace into a \`.twbx\` in memory (synthesizing the datasource references, the zombie sheet on the
dashboard, and the dashboard-extension manifest) and checks structure, asset references, and size. A
clean validation is a precondition to publish; it says nothing about whether the app is the right app
(you cannot verify that until it renders in Tableau after publish).

If validation reports problems, fix the workspace and validate again.

When validation succeeds, preserve the returned \`validationId\` exactly as returned. That
\`validationId\` is the receipt for the immutable package that was validated; do not discard, rewrite,
or replace it with the workspace ID or source content.

## 6. Ask explicitly before publishing

Never auto-publish. Ask, in plain language, whether the user wants this app published to their Tableau
site — publishing creates content there, and that is the user's decision. "Looks good" on the plan is
not consent to publish; get a clear yes to publishing specifically. If there is no clear yes, stop —
the validated workspace can sit untouched with nothing lost.

## 7. Publish only the validation receipt

On an explicit yes, pass the preserved \`validationId\` to \`create-and-publish-workbook\`. Never
re-send the app's source content at publish time, and never publish a workspace that has not just been
validated. Publishing consumes that exact receipt so the bytes that go live are exactly the bytes that
were validated.

On success, surface the returned canonical URL verbatim — do not rewrite, shorten, or substitute the
host — and report any non-fatal warnings.

## 8. Review the live app in Tableau

Direct the user to open the published workbook in Tableau to review the app running against live data
— this is where the visual review happens (you could not run the live query while authoring). If the
user wants changes, update the workspace files (step 4), re-validate, and republish.
`;
