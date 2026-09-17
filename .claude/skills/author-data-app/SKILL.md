---
name: author-data-app
description: End-to-end workflow for building a Tableau data app — scaffold a new app with the scaffold-data-app MCP tool (and finalize its postUnzip plan on remote/http), author the extension's query + visualization yourself from the human's stated criteria/vibe, then package the workspace into a .twbx and publish it with the MCP publish-workbook flow. Use whenever a user wants to create, build, or publish a Tableau data app.
---

# Author Data App

Builds a Tableau data app from nothing to published. Walk the phases top to
bottom.

```
1. Scaffold + finalize  →  1.5 Wire datasource*  →  2. Author (you)  →  3. Package  →  4. Publish
```

\* Phase 1.5 is a prerequisite to a *working* app: the name-only
`scaffold-data-app` ships an empty `<datasources/>`, so a scaffolded app reaches
no datasource at runtime and renders "no data source found." Wire the target
published datasource into the `.twb` before authoring against it. (Publishing the
starter as-is to prove packaging works does not need it.)

**Division of labor: you write ALL the code, every phase, always — including
`app.js`.** The human "vibe codes" by describing what they want (criteria,
theme, vibe, target insights) — they do not write `app.js` themselves. Read
the two bundled guides before authoring: [design-data-app.md](design-data-app.md)
(what to build) and [build-data-app.md](build-data-app.md) (how, using this
skill's local tools). Only skip authoring `app.js` if the human explicitly says
they want to write it themselves for this app (rare) — in that case hand off
the workspace path and point them at both guides as their own reference.

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

Do **not** hand-edit the XML — the wiring spans four coordinated locations (root
datasource `name`, root `relation connection`, view `datasource name`,
`datasource-dependencies datasource`) that must all carry the identical
`sqlproxy.<hash>` join key, and both empty anchors must be filled. Use the bundled
[wire-datasource.mjs](wire-datasource.mjs) script, which does all four edits
atomically and hard-fails rather than emitting a half-wired workbook.

1. **Get the datasource's identity** with `list-datasources` (LUID, name/caption,
   contentUrl, and the server host + site) and `get-datasource-metadata({ datasourceLuid })`
   (field names + datatypes). The published DS **contentUrl** is the
   `repositoryId`.
2. **Write a descriptor** listing *only the fields the app will query* (name +
   datatype + role), e.g.:

   ```bash
   cat > "$WORK/descriptor.json" <<'DS_JSON'
   {
     "caption": "<Friendly Name>",
     "repositoryId": "<published DS contentUrl>",
     "site": "<site>",
     "server": "<server host, e.g. 10ax.online.tableau.com>",
     "channel": "https", "port": 443,
     "fields": [
       { "name": "Profit", "datatype": "real",   "role": "measure"   },
       { "name": "Region", "datatype": "string", "role": "dimension" }
     ]
   }
   DS_JSON
   ```

3. **Run the wiring script** (it prints the wired `.twb` path, and generates a
   consistent `sqlproxy.<hash>` unless you supply `connectionName`):

   ```bash
   node "$SKILL_DIR/wire-datasource.mjs" "<App Name>/<App Name>.twb" "$WORK/descriptor.json"
   ```

The script hard-fails if an anchor is missing (already wired / template drifted),
if any empty `<datasources />` survives, or if the join key isn't referenced ≥4×.
Trust that failure over patching the XML by hand. `datatype` maps to the column
`type` (`real`/`integer` → quantitative, `date`/`datetime` → ordinal, else
nominal); `role: "measure"` gets a `Sum` aggregation, `dimension` a `Count`.

> **Long-term fix (separate follow-up, not this skill):** enhance the
> `scaffold-data-app` MCP tool to accept `datasources` LUIDs and emit this wiring
> server-side (as the `compass/data-apps-dev` branch does), retiring this client
> step. Until that lands, `wire-datasource.mjs` is the near-term path. File it as
> its own work item.

---

## Phase 2 — Author

**Always author `app.js` yourself — this is the fixed default, not a
fallback.** The human vibe-codes: they describe what they want (criteria,
theme, target insights, audience) and you turn that into the actual
`ds.queryAsync(...)` → chart implementation. Read
[design-data-app.md](design-data-app.md) (what to build) and
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

### Rare exception: the human wants to write `app.js` themselves

Only skip authoring if the human explicitly says they want to write `app.js`
themselves for this app — an override of the default, not the norm. In that
case, stop and hand off: tell them the workspace path
(`Packages/com.tableau.mcp.<slug>/content/src/app.js`) and point them at
[design-data-app.md](design-data-app.md) and [build-data-app.md](build-data-app.md)
as their own reference. Resume at phase 3 once they say it's authored.

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
- **Hand-editing the `<datasources/>` wiring.** Use `wire-datasource.mjs` — freehand
  edits mismatch the `sqlproxy.<hash>` join key across its four locations or leave an
  empty `<datasources />` anchor, and the app silently reaches no data.
- **Running finalize on a local result.** A result with `filePath` and no
  `postUnzip` is already done; skip straight to phase 3 (after authoring).
- **Handing off `app.js` to the human unprompted.** Phase 2 authoring is the
  fixed default — always write `app.js` yourself from the human's stated
  criteria/vibe. Only hand off when the human explicitly says they want to
  write it themselves.
- **Shipping OS cruft.** Exclude `.DS_Store` / `__MACOSX` from the `.twbx`.
