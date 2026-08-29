// The canonical, server-side source of truth for the "build a data app" workflow. Served as the
// MCP resource `skill://tableau/build-data-app` (see buildDataAppResource.ts). Any client-specific
// adapter (e.g. the .claude skill) should point here rather than duplicating this guidance.
export const buildDataAppSkill = `# Build a trusted, governed, scalable dashboard, report or Data App

## What this is

A workflow for turning a business question into a small, self-contained Tableau **data app** — a
bundled **viz (worksheet) extension** that queries a **published Tableau datasource live** — and,
when the user wants it, publishing that app to their Tableau site.

This workflow assumes you are starting from a **known published datasource** (you have, or can find,
its LUID). Decide what the user is trying to see, then wire the app to that datasource and author the
query + visualization against it.

**Read the design skill first for *what* to build.** \`skill://tableau/design-data-app\` owns the
design layer — message-first structure, chart/encoding choice, graphical integrity, accessible color,
and how to verify the result. This skill owns *how* the app is wired, validated, and published.

## Live-query model (read this first)

**The data app queries its datasource live via the Tableau Extensions API — there is NO embedded data
snapshot.** The shipped app calls \`readMetadataAsync()\` / \`queryAsync()\` at view time against the
published datasource, so it always reflects current data. Two things follow from this, and both are
handled for you by the tools — do not fight them:

1. **The app reaches datasources through the workbook, and queries them directly.** This is a viz
   extension hosted on a worksheet, so it uses \`tableau.extensions.workbook.getAllDataSourcesAsync()\`
   to reach every datasource wired into the workbook, then calls \`ds.readMetadataAsync()\` /
   \`ds.queryAsync(query)\` on a datasource. It does **not** read marks-card summary data
   (\`getSummaryDataReaderAsync\` / \`getSummaryDataAsync\`) and the host worksheet declares **no
   encodings** — the app builds its own VDS query instead of consuming a marks-card viz.
   \`scaffold-data-app\` wires the host worksheet to depend on each target datasource so none is
   pruned at publish — you do not create any helper sheet yourself. Results come back in the standard
   VizQL Data Service shape \`{ data: [...] }\`; the scaffold's \`extractData()\` helper reads
   \`result.data\` — use it, and match columns by field name (not position).
2. **You cannot run the live query yourself.** A live query only executes inside the Tableau host, so
   you cannot see real rows until the app is published and opened in Tableau. While authoring,
   introspect the datasource with the metadata/query tools (\`get-datasource-metadata\` /
   \`query-datasource\`) to design and sanity-check the query; do the **visual** review in Tableau
   **after** publishing.

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
workbook's host worksheet to depend on those datasources, and writes a live boot skeleton
(\`index.html\`, \`src/app.js\`, \`src/styles.css\`). It does NOT write your query or visualization —
that is your job in the next step. It does not embed any data.

## 4. Introspect the datasource, then author the app

Use the Tableau metadata/query tools (for example \`get-datasource-metadata\` and
\`query-datasource\`) to understand the datasource's fields, then author \`src/app.js\` with
\`upsert-data-app-files\`:
- Build a VDS query (fields + optional filters/aggregations) and call \`ds.queryAsync(query)\`.
- Read the rows with the provided \`extractData()\` helper (it returns \`result.data\`); match
  columns by field name, not by position.
- Render with **safe DOM APIs** (\`textContent\` / \`createElement\`) — never \`innerHTML\` with live
  values (the data is untrusted and this prevents XSS).

Always prefer to derive new fields or change data shapes at query time.
There is no required file layout, chart count, or palette — a good app clearly addresses the user's
objective. See \`skill://tableau/design-data-app\` for how to choose the encoding, structure the
narrative, and make it truthful and accessible.

### Lifecycle & sandbox rules (the app runs inside Tableau, not a browser)

The published app runs in the Tableau viz-extension sandbox. It behaves differently from an ordinary
web page, and these rules are the difference between an app that renders and a silent blank one:

- **Surface every error on-screen.** The sandbox has **no visible console**, and you cannot run the
  live query while authoring — the *only* way you (or the user) will see a failure is if the app
  paints it. Always render an explicit "Live query unavailable: <reason>" (or similar) element on any
  init/query/render error. There is no static data fallback; the honest failure state *is* the
  fallback.
- **Render first, initialize second.** The extension handshake reloads the page; if you gate the
  first paint on \`await tableau.extensions.initializeAsync()\`, the page can stay blank. Paint the
  app shell / loading state immediately, then upgrade to live data after \`initializeAsync()\`
  resolves.
- **Vendor library _code_ locally — no CDN script/style tags.** The sandbox blocks external CDNs for
  code assets, so any charting/util library (e.g. D3) must be added to the workspace via
  \`upsert-data-app-files\` and referenced with a relative path — never a
  \`<script src="https://cdn…">\` or a remote \`<link rel="stylesheet">\`. This rule is about *loading
  library code*, not about *fetching data*: calling an external data API at runtime is allowed, but
  its origin must be declared (next rule).
- **Declare every external origin the app fetches at runtime.** If the app \`fetch()\`/XHRs any origin
  other than its own — e.g. an external API the user wants it to pull live data from — that origin
  must be declared via the \`allowedOrigins\` param on \`upsert-data-app-files\` /
  \`patch-data-app-file\`, **in the same call that writes the fetch**. The published app runs under a
  strict Content-Security-Policy: a request to an undeclared origin is blocked, and (per the no-console
  rule above) the only symptom is the on-screen error your fetch's \`catch\` renders. So when a user
  says "have the app pull X from <service>", author the fetch AND pass
  \`allowedOrigins: "https://<service-host>"\` in the same tool call. The param **replaces** the whole
  allow-list (it does not append), so when a later call adds a fetch to a *new* origin, pass the
  **complete** set — the new origin *and* every origin declared earlier — or the earlier ones are
  silently dropped and their fetches start failing. List exactly the origins the app needs — nothing
  speculative. Same-origin requests need no declaration.
- **Prefer 2D (SVG / Canvas / plain DOM) over WebGL.** The sandbox often cannot create a WebGL
  context, so three.js / globe.gl-style renderers paint blank. Draw with SVG, 2D Canvas, or DOM.

## 5. Validate the final workspace

Validate the workspace with \`validate-workbook-package\` before offering to publish. It packages the
workspace into a \`.twbx\` in memory (synthesizing the datasource references, the viz-extension host
worksheet, and the worksheet-extension manifest) and checks structure, asset references, and size. A
clean validation is a precondition to publish; it says nothing about whether the app is the right app
(you cannot verify that until it renders in Tableau after publish).

If validation reports problems, fix the workspace and validate again. Validation also emits
**advisory** warnings when the packaged code appears to fetch an external origin you did not declare
in \`allowedOrigins\` — treat each one as a prompt to declare that origin (re-passing the complete set,
since the param replaces the list) and re-validate, unless the reference genuinely isn't a runtime
fetch. These advisories do not block the receipt, but an undeclared origin *will* be blocked by the
published app's CSP.

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

## 8. Review the live app in Tableau (this is the only "preview")

There is **no local preview** — a live query only runs inside the Tableau host, so the app cannot be
previewed from a third-party client. The review happens by **loading the published app in Tableau**:
the natural target for an iteration pass is the user's **personal space**, where they can open the
workbook and see the app running against live data without affecting shared content. (On first load a
one-time extension trust prompt may appear — that is an expected human gate, not a failure.)

Direct the user to open the published workbook and review it there against the design checks in
\`skill://tableau/design-data-app\` (the 5-second test and the takeaway test). If the user wants
changes, update the workspace files (step 4), re-validate (step 5), and republish (steps 6–7). Repeat
until it reads.
`;
