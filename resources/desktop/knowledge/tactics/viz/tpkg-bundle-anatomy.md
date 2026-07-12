# Tableau Package (.tpkg) Bundle Anatomy

## Scope Check

- Primary audience: an agent or SE about to vibe-code and hand-assemble a bundled Tableau extension (`.tpkg`) instead of side-loading loose files
- Authoring outcome improved: produce a `.tpkg` whose `manifest.json`, `.trex`, and `content/` layout parse and load on the first try — by copying an evidenced-good bundle's exact shape rather than guessing the format
- In-scope reason: the file-format half of "vibe-coding a bundled extension"; the API/lifecycle/install half lives in the workflow companion
- Out-of-scope risk: NOT a signing/Exchange-publishing guide, NOT the Extensions API reference. Bundle *format* only
- Tags: tpkg, bundled extension, manifest.json, trex, dashboard-extension, worksheet-extension, extension_manifest xmlns, source-location url, content layout, reverse-domain id, extension-version, permissions full data, create-tpkg, tableau packages disk cache, artifactory bundle manifest, extensions folder history
- Relevant user prompts/search terms: "what goes in a tpkg", "tableau package manifest.json schema", "trex manifest structure bundled", "content folder extension layout", "extension-version vs manifestVersion", "bundle a dashboard extension into a tpkg", "relative url in trex means bundled", "how does create-tpkg.js assemble the package", "package a vibe-coded extension", "tpkg naming version convention", "tableau packages disk cache directory", "where does tableau install a bundled extension on disk", "artifactory bundle manifest versioned dir", "did the extensions folder used to be called trex"

Enforcement: judgment-only

## When to Use

Read this when you are **assembling** a `.tpkg` (a zip that bundles an extension's manifest + web assets) and need the exact on-disk shape: the `manifest.json` keys, the `.trex` element/attribute set, where `content/` files go, and the naming/versioning rules. Reach for the companion — `expertise://tableau/tactics/viz/extension-vibe-coding-workflow` — for the end-to-end (API code, packaging command, install path), and `expertise://tableau/tactics/viz/building-viz-extensions` for the render/lifecycle debugging of the web app itself.

This applies to:

- Turning a working `content/<slug>/index.html`+`main.js` into a distributable `.tpkg`
- Hand-editing or reviewing a `manifest.json` / `.trex` for a bundled extension
- Understanding what `create-tpkg.js` emits so an agent can reproduce or extend it

## Best Practices

- **Copy an evidenced-good bundle's shape, don't invent it.** The layout below is quoted verbatim from a complete worked bundle (`attrition-kpi`, a dashboard extension). Mirror its key set and element order.
- **Three parts, one zip.** A `.tpkg` is an ordinary zip containing exactly: (1) `manifest.json` at the root, (2) one or more `extensions/*.trex` extension manifests, (3) a `content/` tree of web assets. `content/` is required in the zip **even if** every extension used a remote URL. The sandbox rule is confirmed evidence: relative asset paths are resolved *under* the `.tpkg`, never above it (W49 Slack digest, 2026-07-06).
- **The manifest folder is `extensions/` — it used to be `trex/`.** The canonical name is `extensions/`; it was renamed from `trex/` (W49 Slack digest, 2026-06-12 rename thread). The worked `attrition-kpi` anchor uses `extensions/` (see the verbatim layout below), so mirror that; treat a `trex/` folder as the legacy name only.
- **Relative `<url>` = bundled; absolute = remote.** A `<source-location><url>` with no `://` (e.g. `attrition-kpi/index.html`) is resolved *from* `content/` — so you **omit the `content/` prefix** in the URL. A `://` URL loads a remotely hosted extension instead.
- **Slug = last reverse-domain segment.** `create-tpkg.js` derives the package/extension/content folder slug as `packageId.split('.').pop()` — `com.tableau.attrition-kpi` → `attrition-kpi`. The `content/<slug>/` folder, the `.trex` filename, and the URL prefix all reuse that one slug.
- **Root element encodes the extension type.** `dashboard-extension` (dashboard object), `worksheet-extension` (viz on the Marks card), or `workspace-extension`. The `.trex` `id` in the worked bundle is `<packageId>.<type-suffix>` (e.g. `com.tableau.attrition-kpi.dashboard`).
- **Two version fields, two meanings.** `manifest.json` carries `version` (the package release) and `manifestVersion` (`"0.1"`, the package-manifest schema version). The `.trex` carries `manifest-version="0.1"` (the trex schema) and `extension-version` (the extension's own semver). Keep the package `version` and the primary extension's `extension-version` aligned.
- **Localize the display name through `<resources>`.** `<name resource-id="name"/>` points at a `<resource id="name"><text locale="en_US">…</text></resource>`; `<default-locale>` names the fallback.

## Common Mistakes

1. **Putting `content/` in the `<url>`.** For a bundled extension the URL is relative to `content/`, so `content/attrition-kpi/index.html` is wrong — use `attrition-kpi/index.html`.
2. **Omitting `content/` from the zip** when the extension is remote — it is still required.
3. **Confusing `version` / `manifestVersion` / `extension-version`.** They are three distinct fields; only `manifestVersion` and the trex `manifest-version` are the fixed schema string `"0.1"`.
4. **Inventing a fresh id per rebuild.** The `id` is the stable identity Tableau trusts; changing it re-triggers the one-time trust prompt and orphans prior placements.
5. **`::` / `../` / symlinks in a `<url>`.** Path traversal and symlinks are rejected — keep every asset a plain relative path under `content/`.
6. **Assuming the viz `.trex` and dashboard `.trex` are identical.** A `worksheet-extension` additionally declares `<encoding>` blocks (the Marks-card contract); a `dashboard-extension` does not.
7. **Naming the manifest folder `trex/`.** That is the pre-rename name (renamed to `extensions/` on 2026-06-12); the current/anchor layout uses `extensions/`.

## Implementation

**The real `manifest.json`** (quoted verbatim from the worked `attrition-kpi` bundle — this is the complete, evidenced key set):

```json
{
  "id": "com.tableau.attrition-kpi",
  "version": "1.0.0",
  "manifestVersion": "0.1",
  "name": "Attrition KPI",
  "author": {
    "name": "Example Corp",
    "email": "dev@example.com"
  },
  "description": "Single big KPI tile showing current attrition rate vs. target"
}
```

**The real `extensions/attrition-kpi.trex`** (verbatim; a `dashboard-extension` with a `<permissions>` block — the `<icon>` base64 is elided here as `…`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <dashboard-extension id="com.tableau.attrition-kpi.dashboard" extension-version="1.0.0">
    <default-locale>en_US</default-locale>
    <name resource-id="name"/>
    <description>Big KPI tile: current attrition rate vs. target</description>
    <author name="Example Corp" email="dev@example.com"
            organization="Example Corp" website="https://example.com"/>
    <min-api-version>1.1</min-api-version>
    <source-location>
      <url>attrition-kpi/index.html</url>
    </source-location>
    <icon>iVBORw0KGgoAAAANSUhEUgAAAEAAAA…</icon>
    <permissions>
      <permission>full data</permission>
    </permissions>
  </dashboard-extension>
  <resources>
    <resource id="name">
      <text locale="en_US">Attrition KPI</text>
    </resource>
  </resources>
</manifest>
```

**On-disk / in-zip layout** (mirrors the worked bundle exactly):

```
attrition-kpi/                    ← package dir (slug = last id segment)
  manifest.json
  extensions/
    attrition-kpi.trex            ← <slug>.trex
  content/
    attrition-kpi/                ← content/<slug>/
      index.html                  ← <script src="tableau.extensions.1.latest.js">, then main.js
      main.js
      tableau.extensions.1.latest.js   ← the vendored Extensions API library
```

**Installed on disk (the two paths a bundle can reach a workbook).** The `.tpkg` shape above is also the *installed* shape. When a package is published/installed, its versioned server resources land at `~/Library/Application Support/Tableau/Packages/<id>/<version>/`, a tree **isomorphic to the `.tpkg`** — i.e. a straight folder-copy publish (W49 digest, 2026-07-06; the Artifactory→disk flow merged 2026-07-02, see the workflow companion). The *other* path is workbook-embedded resources, which are read from the `.twbx` through `ArchiveWorkbookParser` — Lee's framing: "the workbook is the container" (Lee, W49 digest, 2026-06-30). So the same bundle shape serves two locations: the server-resource cache (`Packages/<id>/<version>/`) or embedded in the `.twbx`.

**How `create-tpkg.js` assembles it** (the evidenced scaffolder, for reference):

1. Derives `packageSlug = packageId.split('.').pop()`, `extId = `${packageId}.${type}``, and the XML root from `type` (`viz`→`worksheet-extension`, `dashboard`→`dashboard-extension`, `workspace`→`workspace-extension`).
2. `mkdir -p extensions/` and `content/<slug>/`.
3. Writes `manifest.json` (the six keys above), `extensions/<slug>.trex`, `content/<slug>/index.html`, and `content/<slug>/main.js`. For a `viz` type it adds an `<encoding id="drop">` block to the `.trex`; a `dashboard` type omits it.
4. Downloads `tableau.extensions.1.latest.js` into `content/<slug>/` (this network step is deliberately **dropped** in the offline scaffold `evals/tools/make-extension-scaffold.mjs`, which emits a labelled placeholder instead — vendor the real SDK before loading).
5. Zips the distributable: `zip -r <slug>-<version>.tpkg manifest.json extensions/ content/`, producing `<slug>-1.0.0.tpkg` next to the source dir.

**Validation checklist before distributing** (from the tpkg-skill): `manifest.json` has `id`/`version`/`name`; each `.trex` has no `://` in a bundled `<url>`; no `../` traversal; no symlinks in the archive.

## Related Knowledge

- End-to-end build/package/install: [Vibe-coding a bundled Tableau extension](data/knowledge/tactics/viz/extension-vibe-coding-workflow.md) (`expertise://tableau/tactics/viz/extension-vibe-coding-workflow`).
- Rendering / lifecycle / local side-load of the web app: [Building Tableau Viz Extensions](data/knowledge/tactics/viz/building-viz-extensions.md) (`expertise://tableau/tactics/viz/building-viz-extensions`).

## Source and Confidence

- Source/evidence type: artifact-derived — quoted verbatim from a complete worked bundle (`attrition-kpi` v1.0.0: `manifest.json`, `extensions/attrition-kpi.trex`, `content/attrition-kpi/{index.html,main.js}`) and from `create-tpkg.js` (the tpkg-skill scaffolder). Bundle *format* is confirmed by the artifacts; load behavior of a freshly-assembled `.tpkg` was not re-tested here.
- Provenance of the tpkg-skill / `create-tpkg.js` anchor: it is **Kyler's `tableau-package` Claude skill**, which scaffolds a `.tpkg` and iterates its `html`/`js` (shared in proj-tab-tableau-studio, 2026-06-25). <!-- @drift-allowed: tableau-package is a Claude skill name, not an MCP tool -->
- Slack-evidenced facts (disk cache path, `trex/`→`extensions/` rename, `.twbx` container framing, sandbox rule): W49 Slack digest, 2026-07-06. Attributions are carried inline as author + date (and MR#); the underlying permalinks live in the session transcript, not the digest.
- Customer-identifying details removed: yes (author/org are the artifact's own `Example Corp` placeholders)
- Confidence: artifact-evidenced (format); Slack-evidenced (disk layout, naming history, provenance); load-tested behavior deferred to the workflow companion and GAPS
- Last reviewed: 2026-07-06
