---
name: author-data-app
description: End-to-end workflow for building a Tableau data app — scaffold a new app with the scaffold-data-app MCP tool (and finalize its postUnzip plan on remote/http), pause for a human to author the extension, then package the workspace into a .twbx and publish it with the MCP publish-workbook flow. Use whenever a user wants to create, build, or publish a Tableau data app.
---

# Author Data App

Builds a Tableau data app from nothing to published. Walk the phases top to
bottom.

```
1. Scaffold + finalize  →  1.5 Wire datasource*  →  2. Author (human)  →  3. Package  →  4. Publish
```

\* Phase 1.5 is a prerequisite to a *working* app: the name-only
`scaffold-data-app` ships an empty `<datasources/>`, so a scaffolded app reaches
no datasource at runtime and renders "no data source found." Wire the target
published datasource into the `.twb` before authoring against it. (Publishing the
starter as-is to prove packaging works does not need it.)

When the user wants you to actually author the app (not just hand off the
starter), read the two bundled guides first:
[design-data-app.md](design-data-app.md) (what to build) and
[build-data-app.md](build-data-app.md) (how, using this skill's local tools).

There is intentionally **no separate validation phase** — a TWBX cannot be
pre-validated (Tableau validates extracts/extensions at publish time), so
`publish-workbook` surfaces any errors when you reach phase 4. The one thing you
must get right before then is package *layout* (phase 3), or the workbook won't
open at all.

---

## Phase 1 — Scaffold + finalize

Call the `scaffold-data-app` MCP tool with the app name:

> scaffold-data-app({ datappName: "Sales Demo" })

The result shape tells you which transport you're on and what's left to do:

- **local (stdio):** result has `filePath` and **no** `postUnzip`. The workspace
  is already written to disk, fully substituted. **Nothing more to do in this
  phase** — the workspace is at `filePath`.
- **remote (http):** result has `s3URL` + a `postUnzip` plan. The server returned
  an *un-substituted* template zip; the client must download, unzip, and apply
  the plan. Do this deterministically with the bundled script — applying it
  freehand leaves half-replaced `TODO-MANIFEST-ID` / `TODO App Name` tokens or
  interleaves edits and renames in the wrong order.

### Finalizing a remote (postUnzip) result

```bash
SKILL_DIR="<absolute path to this skill directory>"
WORK="$(mktemp -d -t dataapp)"

# 1. Save the postUnzip object verbatim (do NOT reformat — find tokens must match byte-for-byte)
cat > "$WORK/plan.json" <<'PLAN_JSON'
{ …paste the result's postUnzip object here… }
PLAN_JSON

# 2. Download + unzip the template from the (short-lived) s3URL
curl -fsSL "<s3URL>" -o "$WORK/template.zip"
mkdir -p "$WORK/unzipped"
unzip -q "$WORK/template.zip" -d "$WORK/unzipped"

# 3. Apply the plan (edits first, then renames; verifies no placeholders survive)
node "$SKILL_DIR/apply-plan.mjs" "$WORK/unzipped" "$WORK/plan.json"
```

`apply-plan.mjs` prints the finalized workspace root on stdout. See
[apply-plan.mjs](apply-plan.mjs) for the full contract; it hard-fails if a `find`
token is missing (the served zip is stale / out of sync with the plan) rather
than emitting a broken workspace.

At the end of phase 1 you have a finalized workspace directory:
```
<App Name>/
  <App Name>.twb
  Packages/com.tableau.mcp.<slug>/
    manifest.json
    extensions/data-app.trex
    content/index.html
    content/src/app.js      ← the authoring surface
    content/src/…
```

---

## Phase 1.5 — Wire the published datasource (prerequisite for a working app)

The scaffolded `.twb` ships an **empty `<datasources/>`** (both at the workbook
root and inside the worksheet `<view>`). At runtime the app calls
`getAllDataSourcesAsync()` and finds nothing → it renders **"no data source found
in the workbook."** To query live data the workbook must have a real published
datasource wired in.

**Do this only once the user has named a target published datasource.** It is
skippable if the user only wants to publish the starter to prove packaging.

1. **Get the datasource's identity** with `list-datasources` (find its LUID and
   name) and `get-datasource-metadata({ datasourceLuid })` (fields to query).
2. **Add a workbook-root `<datasource>`** inside the empty `<datasources/>`, an
   inline `sqlproxy` (Data Server) connection. Mirror the *structure* of the
   synthetic Superstore reference at
   `/Users/patrick.green/Downloads/Snake/Superstore Data App.twb` (sample data, no
   PII). Shape:

   ```xml
   <datasource caption='<Friendly Name>' inline='true' name='sqlproxy.<hash>' version='18.1'>
     <repository-location id='<datasource repo id>' path='/datasources' revision='1.0' site='<site>' />
     <connection channel='https' class='sqlproxy' dbname='<datasource repo id>'
                 directory='dataserver' port='443' server='<server host>'
                 server-ds-friendly-name='<Friendly Name>' username=''>
       <relation connection='sqlproxy.<hash>' name='sqlproxy' table='[sqlproxy]' type='table' />
       <metadata-records>
         <!-- one <metadata-record class='column'> per field you will query -->
       </metadata-records>
     </connection>
     <!-- one <column .../> per field you will query -->
   </datasource>
   ```

3. **Reference it from the worksheet.** In the worksheet `<view>`, replace the
   empty `<datasources/>` with a `<datasources><datasource caption=… name='sqlproxy.<hash>' /></datasources>`
   pointing at the same `name`, and add a `<datasource-dependencies datasource='sqlproxy.<hash>'>`
   block listing the `<column>` / `<column-instance>` for the fields the app uses.

Populate `server`/`site`/`dbname` from the `list-datasources` /
`get-datasource-metadata` output for the user's datasource. **This wiring is
fragile and server/site-specific** — the `name='sqlproxy.<hash>'` must be
identical everywhere it appears, and the worksheet reference must match the
workbook-root datasource.

> **Long-term fix (separate follow-up, not this skill):** enhance the
> `scaffold-data-app` MCP tool to accept `datasources` LUIDs and emit this wiring
> automatically (as the `compass/data-apps-dev` branch does). Until that lands,
> this manual step is required. File it as its own work item.

---

## Phase 2 — Author

**Default: hand off to the human.** This skill does **not** write app logic on
its own. The starter `content/src/app.js` carries an `AUTHOR YOUR APP HERE` marker;
the extension queries its published datasource live and renders a visualization.
Unless the user asks you to author, **stop and hand off**: tell them the workspace
path and that they (or a follow-up pass) should edit
`Packages/com.tableau.mcp.<slug>/content/src/app.js`. Do not fabricate query/chart
logic unprompted. Resume at phase 3 once they say it's authored (or want to publish
the starter as-is).

### When the user asks you to author the app

Read [design-data-app.md](design-data-app.md) (what to build) and
[build-data-app.md](build-data-app.md) (how) first, then:

1. **Introspect the datasource.** `list-datasources` → find the LUID →
   `get-datasource-metadata({ datasourceLuid })` for fields/model/params →
   `query-datasource({ datasourceLuid, query, limit })` to preview real VDS
   `{ data: [...] }` rows and confirm field captions/types before committing to a
   chart. (Ensure Phase 1.5 wiring is done — the app can't query without it.)
2. **Design what to build** using [design-data-app.md](design-data-app.md): pick
   the archetype by audience, lead with the message (BLUF), choose the mark by the
   perception hierarchy, keep graphical integrity (zero baseline, "as of"
   provenance), use action titles + direct labels, and restrained color (grey +
   one accent, colorblind-safe).
3. **Edit `content/src/app.js` on disk** (there is no upsert tool). Inside the
   `AUTHOR YOUR APP HERE` block, replace the `renderStarter(...)` call with a real
   `ds.queryAsync(query)` → `extractData(result)` → build a Vega-Lite spec →
   `vegaEmbed(el, spec)`; match columns by field name. Vendor
   vega/vega-lite/vega-embed locally under `content/src/` and load them from
   `index.html` (mirror how `tableau.extensions.1.latest.js` is already vendored
   relative and loaded before `app.js`).
4. **Follow the sandbox rules in the `AUTHOR YOUR APP HERE` comment** — that
   comment is the source of truth (render-first/initialize-second, surface every
   error via `renderError`, no CDN, 2D over WebGL, `textContent`/`createElement`
   never `innerHTML` with live values). Don't re-derive them.
5. **There is no local preview.** You cannot see the app render against live data
   while authoring — the visual review happens live in Tableau after publish
   (phase 4).

---

## Phase 3 — Package into a .twbx

A `.twbx` is a zip of the workspace **contents** with the `.twb` and `Packages/`
at the **archive root** — never nested inside the `<App Name>/` folder. Nesting
is the #1 cause of `NativeException: An unexpected error occurred opening the
packaged workbook` and `PackageValidationException: Package directory contains no
extension .trex files under extensions/`.

Package with the proven two-step zip (run from *inside* the workspace dir so
paths are root-relative), excluding OS cruft:

```bash
cd "<App Name>"                      # the finalized workspace dir
OUT="../<App Name>.twbx"
rm -f "$OUT"
zip -X    "$OUT" "<App Name>.twb"                                    # .twb at root, first
zip -rX   "$OUT" Packages -x '*.DS_Store' '*/.DS_Store' '__MACOSX*'  # package tree, no cruft
unzip -l "$OUT"                      # sanity: .twb + Packages/… at top level, no <App Name>/ prefix
```

The listing must show `<App Name>.twb` and `Packages/com.tableau.mcp.<slug>/…`
at the top level with no wrapping folder and no `.DS_Store`/`__MACOSX` entries.

> The template these workspaces come from is already publish-valid (`.twb`
> extension wired into a pane, `.trex` with `author email`, `<resources>` block,
> `<icon>`, `min-api-version`). Packaging is the only structural step you own.

---

## Phase 4 — Publish

Uses the MCP publish tools (gated by the `authoring-tools` feature; not available
to Slack clients).

1. **Find the target project LUID:**
   > list-projects({})
   Pick the project the user wants (ask if ambiguous).

2. **Publish.** Two paths — pick based on transport:

   - **Local (stdio), simplest:** the `.twbx` is on the MCP server's own
     filesystem, so pass it directly:
     > publish-workbook({ workbookFilePath: "<abs path to .twbx>", name: "<App Name>", projectId: "<LUID>", overwrite: false })

   - **Remote (http) / staged uploads configured:** stage the bytes first, then
     publish by id:
     > request-workbook-upload({ filename: "<App Name>.twbx" })   → returns an upload URL + workbookUploadId
     > (upload the .twbx bytes to the returned URL — staged-workbook-upload)
     > publish-workbook({ workbookUploadId: "<id>", name: "<App Name>", projectId: "<LUID>", overwrite: false })

3. **Report the outcome.** On success `publish-workbook` returns
   `status: "published"` with the workbook `url` and any `warnings` — give the
   user the URL. If it returns `status: "invalid"` (or an error), surface the
   `errors`/`warnings` verbatim; common causes trace back to `.twb`/`.trex`
   wiring, not packaging. Set `overwrite: true` only if the user wants to replace
   an existing workbook of the same name.

---

## Common Mistakes

- **Nesting the workspace folder in the .twbx.** Zip the *contents* (`.twb` +
  `Packages/` at root), not the `<App Name>/` directory. Always `unzip -l` to confirm.
- **Applying a postUnzip plan freehand.** Use `apply-plan.mjs` — edits before
  renames, renames deepest-first, verified. See its Common Mistakes section.
- **Running finalize on a local result.** A result with `filePath` and no
  `postUnzip` is already done; skip straight to phase 3 (after authoring).
- **Authoring the app yourself unprompted.** Phase 2 is a human handoff by
  default. Only write `app.js` logic when the user asks.
- **Shipping OS cruft.** Exclude `.DS_Store` / `__MACOSX` from the `.twbx`.
