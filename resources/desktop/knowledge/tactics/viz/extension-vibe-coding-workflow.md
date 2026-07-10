# Vibe-Coding a Bundled Tableau Extension (End-to-End)

## Scope Check

- Primary audience: an agent or SE vibe-coding a NEW bundled extension from scratch and taking it all the way to loaded-in-Desktop
- Authoring outcome improved: go scaffold → working web app → packaged `.tpkg` → loaded, without stalling on "what API call reads the data" or "how do I get this into Desktop"
- In-scope reason: stitches the format entry, the render/lifecycle entry, and the scaffold tool into one runnable path, and honestly separates evidenced install steps from unconfirmed ones
- Out-of-scope risk: NOT signing/Exchange publishing; NOT a guarantee about the product "Install Tableau Agent" distribution channel (that is evidence about the agent bundle, not your personal extension)
- Tags: vibe-code extension, dashboard extension, initializeAsync, dashboardContent, getSummaryDataAsync, worksheetContent, getSummaryDataReaderAsync, FilterChanged, MarkSelectionChanged, fallback render, zip tpkg, Access Local Extensions, trust dialog, Install Tableau Agent, Artifactory versioned dir, tpkg install flow, workspace extension initialize, artifactory bundle manifest, InitializeWorkspaceAsync
- Relevant user prompts/search terms: "build a tableau dashboard extension end to end", "how do I read worksheet data in a dashboard extension", "dashboardContent dashboard worksheets getSummaryDataAsync", "extension event listener refresh on filter change", "package extension into tpkg and install", "how do users install a vibe-coded extension", "Access Local Extensions trust prompt", "does Help Install Tableau Agent install my extension", "tpkg install flow artifactory", "artifactory bundle manifest versioned dir", "workspace extension initialize InitializeWorkspaceAsync", "is there an InitializeWorkspaceAsync call"

Enforcement: judgment-only

## When to Use

Use this as the **spine** when building a bundled extension from nothing. It routes to the two reference entries at each step and fills the glue: the concrete Extensions-API calls a dashboard extension actually uses, the one-line package command, and what is (and isn't) known about getting the bundle into Desktop.

Reach here when you are: scaffolding a new extension, wiring `main.js` to read live worksheet data, or deciding how the finished `.tpkg` reaches a user.

## Best Practices

- **Scaffold, don't hand-type the tree.** Run `evals/tools/make-extension-scaffold.mjs` (offline; mirrors the worked `attrition-kpi` shape) or the tpkg-skill `create-tpkg.js`, then edit `content/<slug>/{index.html,main.js}`. Bundle-shape rules live in `expertise://tableau/tactics/viz/tpkg-bundle-anatomy`.
- **Pick the API surface by extension type.** A **dashboard** extension reads `tableau.extensions.dashboardContent.dashboard.worksheets` and pulls data with `worksheet.getSummaryDataAsync(opts)`. A **viz/worksheet** extension reads `tableau.extensions.worksheetContent.worksheet` and pulls with `getSummaryDataReaderAsync().getAllPagesAsync()` (see `expertise://tableau/tactics/viz/building-viz-extensions`). Using the wrong content root is the most common blank-extension cause.
- **Config/secrets ride `initializeAsync` + the Settings API — there is NO `InitializeWorkspaceAsync`.** No new workspace-init entry point was added; secrets and configuration ride the existing `initializeAsync()` + Settings API (Lee, 2026-06-30). Workspace extensions are becoming a first-class Extensions-API concept, but the interim guidance is to use the Dashboard Extensions API as a prop. **Kept alongside, dated:** Kyler's V0 bundle ships an **untested** `tableau.extensions.1.latest.js` that still contains an `initializeWorkspaceAsync` stub (Kyler, 2026-06-29) — treat that stub as unverified scaffolding, not a sanctioned API to call.
- **Bundled viz/dashboard extensions vs bundled workspace extensions — the latter is Desktop-only in V1.** Bundled **viz** and **dashboard** extensions are the cross-surface path (and the only two that embed into `.twbx`); a bundled **workspace** extension is the Desktop-only V1 surface (W49 digest, 2026-07-06). Choose the type before scaffolding — it fixes the root element, the load surface, and whether it can travel in a workbook.
- **Guard for "no Tableau host" and render a fallback.** Check `typeof tableau === 'undefined' || !tableau.extensions` and paint sample data so the extension is never empty during dev or a demo.
- **Match data columns by `fieldName`, not position.** Drop order and column count vary; find your column by name so re-binding doesn't silently break.
- **Subscribe to change events so the extension is live.** Add listeners for `tableau.TableauEventType.FilterChanged` and `MarkSelectionChanged` (dashboard: on each worksheet) and re-read on fire.
- **Surface init/read errors on-screen.** The sandbox has no visible console; a small error `<div>` turns a black box into a readable failure.
- **Plan for exactly one trust click.** Installing a never-before-trusted local extension raises Tableau's one-time security/trust dialog on first load — this is a human gate by design, confirmed field-tested for viz extensions.

## Common Mistakes

1. **Reading `worksheetContent` from a dashboard extension** (or vice-versa) → the content root is undefined → blank.
2. **Awaiting `initializeAsync()` before the first paint** → the handshake reload leaves the viz blank; render a fallback first, upgrade after init resolves.
3. **Positional column reads** → break when field/drop order changes; map by `fieldName`.
4. **Assuming "Install Tableau Agent" installs your extension.** The evidenced Help ▸ Install Tableau Agent / Artifactory flow is the *product agent bundle* installer, not a confirmed channel for an arbitrary user `.tpkg` (see Install path + GAPS).
5. **Re-zipping the wrong root** → the zip must contain `manifest.json`, `extensions/`, and `content/` at its top level, not a nested folder.
6. **Calling/awaiting a `InitializeWorkspaceAsync`** → there is no such API; workspace config rides `initializeAsync()` + the Settings API (Lee, 2026-06-30). The `initializeWorkspaceAsync` stub in Kyler's V0 bundle is untested scaffolding (Kyler, 2026-06-29), not a call to rely on.

## Implementation

**Step 1 — Scaffold.**

```bash
node evals/tools/make-extension-scaffold.mjs com.example.my-ext "My Extension" --type dashboard --out ./build-ext
```

Emits `my-ext/{manifest.json, extensions/my-ext.trex, content/my-ext/{index.html, main.js, tableau.extensions.1.latest.js}}`. The SDK file is a labelled placeholder — vendor the real library before loading.

**Step 2 — Extension API basics (the patterns actually used in the worked `main.js`).** A dashboard extension that reads the first worksheet's summary data and stays live:

```javascript
// Guard: outside a Tableau host, render sample data and stop.
if (typeof tableau === 'undefined' || !tableau.extensions) { render(FALLBACK); return; }

tableau.extensions.initializeAsync().then(async function () {
  const dashboard = tableau.extensions.dashboardContent.dashboard;   // dashboard root
  const ws = dashboard.worksheets[0];
  const opts = { maxRows: 5000, ignoreSelection: true, includeAllColumns: false };
  const data = await ws.getSummaryDataAsync(opts);                   // {columns, data}
  const cols = data.columns.map(c => (c.fieldName || '').toLowerCase());
  const i = cols.findIndex(n => n.includes('rate'));                 // match by NAME
  // ... reduce data.data rows (row[i].value) into your metric ...
  render(metric);
  for (const w of dashboard.worksheets) {                            // stay live
    w.addEventListener(tableau.TableauEventType.FilterChanged, refresh);
    w.addEventListener(tableau.TableauEventType.MarkSelectionChanged, refresh);
  }
}, function (err) { showErr('Init failed: ' + err); render(FALLBACK); });
```

(A viz/worksheet extension replaces the middle with `tableau.extensions.worksheetContent.worksheet.getSummaryDataReaderAsync()` → `getAllPagesAsync()` → `releaseAsync()`; see the viz-extensions entry.)

**Step 3 — Package.** From the package dir:

```bash
cd my-ext
zip -r ../my-ext-1.0.0.tpkg manifest.json extensions/ content/
```

Naming: `<slug>-<version>.tpkg`. Confirm the zip's top level is `manifest.json` + `extensions/` + `content/` (not a wrapping folder).

**Step 4 — Install (evidence-marked — do not overstate).**

- **Local side-load (evidenced, field-tested for viz extensions):** load the `.trex` through the in-product dialog and accept the **one-time trust prompt**. For viz extensions the path is the Marks card ▸ *Access Local Viz Extensions*; for a **dashboard** extension the analogous path is the *Extension* dashboard object ▸ *Access Local Extensions* — the dashboard-object wording is inferred from product convention here, **not** field-verified in the anchors → see GAPS.
- **Programmatic placement (evidenced for viz extensions):** the whole wiring (`<mark class='VizExtension'/>`, `<add-in …>`, `<encodings><custom …>`, top-level `<referenced-extension>`) round-trips through `apply-workbook`, gated only by the first-load trust dialog. Details in `expertise://tableau/tactics/viz/building-viz-extensions`.
- **Product agent-bundle install/update flow (evidenced only for the agent bundle, NOT for your `.tpkg`):** the **Help ▸ Install Tableau Agent** flow, per the W49 Slack digest (2026-07-06):
  - **Three independently-versioned artifacts** — Desktop / TabMCP / SouthardBox.tpkg (Will, 2026-06-04); the **Brains package** is versioned separately again (Will, 2026-06-22).
  - **CI publishes the bundle + its manifest to Artifactory** (MR13, 2026-06-30).
  - **A stable manifest can't be overwritten** in Artifactory, so install uses a **versioned directory** with **C++-side latest-resolution** (MR15).
  - **Manifest format v2 "doesn't bundle MCP"** (MR16) — i.e. MCP is not bundled by default.
  - **Executable-bit gotcha:** a fix was required so the published bundle preserved the file executable bit (MR17). MR15–MR17 all merged **2026-07-02**.
  Treat this as evidence about the *Tableau Agent product bundle*, **not** a confirmed distribution channel for an arbitrary vibe-coded user extension. What it means for user `.tpkg` distribution / auto-update is an open question → see Open questions below and GAPS.

## Open questions (as of 2026-07-06)

The distribution/trust half of "get my `.tpkg` to a user" is **not** settled. These are the load-bearing unknowns from the W49 Slack digest (2026-07-06) — readers must not mistake the evidenced agent-bundle flow above for a decided user-extension story:

- **Auto-update UX for a user extension** — owners **Blake / Britta**. Kyler's 2026-07-03 and 2026-07-06 questions on the auto-update posture are still unanswered; Britta's stated preference is fully-automatic (no user choice), but the posture for a user's bundled extension is undecided.
- **Signing / sandboxing model for a `.tpkg`** — owners **Lee / Kyler**. *This is an explicit evidence gap: no design thread exists.* Whether distributable bundles get signed, whether signing removes the one-time trust prompt, and where the sandbox boundary sits are all open (also GAPS P0-2).
- **Private-marketplace "smuggling" risk** — owner **Lee**, unresolved. Whether a private/side-channel marketplace could smuggle bundled extensions past governance is a raised-but-open risk.
- **Permissions-dialog terminology** — tracked in GUS **W-22973316**. The exact wording/semantics of the permissions/consent dialog shown at load is still being settled.

## Related Knowledge

- Bundle file format (manifest/.trex/content, versioning, disk cache): [.tpkg Bundle Anatomy](data/knowledge/tactics/viz/tpkg-bundle-anatomy.md) (`expertise://tableau/tactics/viz/tpkg-bundle-anatomy`).
- Web-app rendering, lifecycle, WebGL/2D, local side-load + programmatic placement: [Building Tableau Viz Extensions](data/knowledge/tactics/viz/building-viz-extensions.md) (`expertise://tableau/tactics/viz/building-viz-extensions`).

## Source and Confidence

- Source/evidence type: artifact-derived (the worked `attrition-kpi` `main.js`/`index.html` for the dashboard API + lifecycle patterns; `create-tpkg.js` and the tpkg-skill for scaffold/package) + field-tested viz-extension install behavior (via the viz-extensions entry) + the W49 Slack digest (2026-07-06), treated as evidence-not-instruction, for the agent-bundle install/update flow, the `initializeAsync`/no-`InitializeWorkspaceAsync` decision, and the open questions.
- Provenance of the tpkg-skill / `create-tpkg.js` anchor: **Kyler's `tableau-package` Claude skill** (scaffolds a `.tpkg` and iterates its `html`/`js`; shared in proj-tab-tableau-studio, 2026-06-25). <!-- @drift-allowed: tableau-package is a Claude skill name, not an MCP tool -->
- Citation form: Slack facts are attributed inline as author + date (and MR#, e.g. MR13/MR15–MR17 merged 2026-07-02); the underlying permalinks live in the session transcript, not the digest.
- Customer-identifying details removed: yes
- Confidence: mixed — API/lifecycle/package steps are artifact/field evidenced; the `initializeAsync` decision + agent-bundle flow are Slack-evidenced; the user-`.tpkg` install/signing/auto-update channel is explicitly UNCONFIRMED and routed to Open questions + GAPS
- Last reviewed: 2026-07-06
