// The pure, deterministic TWBX assembler. It takes an entrypoint `html` string or raw bytes plus
// content-relative `assets` (bytes) and emits byte-stable archive bytes. Its single feeder is the
// workspace-snapshot path (`buildWorkspaceTwbx`), which maps an immutable data-app workspace
// snapshot's index.html + sibling files straight through with no split step. That build backs the
// validate-workbook-package receipt that create-and-publish-workbook later uploads verbatim.
// Keep this function pure: identical input → byte-identical output (the determinism tests rely on it).

import { strToU8, zipSync } from 'fflate';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';

export interface BuildTwbxInput {
  /** Reverse-domain id. Becomes BOTH the Packages/<id>/ folder name AND the manifest.json "id".
   *  Single source of truth — folder must equal id or the reader 404s the content. */
  packageId: string; // e.g. "com.example.myviz"
  workbookName: string; // .twb display name + archive base name
  html: string | Uint8Array; // index.html; strings retain compatibility, bytes are preserved exactly
  assets?: Array<{ path: string; bytes: Uint8Array }>; // extra content/ files (js, css, png…)
  toolbar?: { label?: string; iconPngBase64?: string }; // defaults provided
}

/** bytes = the zip; warnings = non-fatal advisories (e.g. a content extension not on the reader's
 *  serve-time allow-list). Callers surface warnings to the agent; they never block a build. */
export interface BuildTwbxResult {
  bytes: Uint8Array;
  warnings: string[];
}

export function buildTwbx(input: BuildTwbxInput): BuildTwbxResult {
  validatePackageId(input.packageId); // (b) legal Extension-Id-ST + (e) safe dir segment
  const files = assembleContentFiles(input); // content/index.html + assets, keyed relative to content/
  validateBundle(files); // (c) source-location resolves + (d) no zip-slip
  const warnings = contentExtensionWarnings(files); // (a) non-blocking — server allows it at publish

  const id = input.packageId;
  // The archive base name becomes an on-disk filename when the server extracts the package, so it
  // must be filesystem-safe (Windows is the strict case). The DISPLAY name — worksheet/window names
  // rendered into the .twb XML — keeps the original workbookName verbatim.
  const fileBase = sanitizeFileNameBase(input.workbookName);
  const zip: Record<string, Uint8Array> = {
    // 1) workbook XML at archive ROOT
    [`${fileBase}.twb`]: strToU8(renderTwb(input)),
    // 2) manifest.json — its "id" MUST equal the Packages/<id>/ folder name
    [`Packages/${id}/manifest.json`]: strToU8(renderManifest(input)),
    // 3) the .trex — <source-location><url>index.html</url></source-location>
    [`Packages/${id}/extensions/toolbar.trex`]: strToU8(renderTrex(input)),
    // 4) content/*
    ...Object.fromEntries(
      Object.entries(files).map(([rel, bytes]) => [`Packages/${id}/content/${rel}`, bytes]),
    ),
  };

  // fflate zipSync is deterministic (stable insertion order, no embedded timestamps) → byte-stable
  // output, which the golden/determinism tests depend on.
  return { bytes: zipSync(zip, { level: 6 }), warnings };
}

// content/ files keyed by their path RELATIVE to content/. index.html is always the entrypoint the
// .trex points at; assets land beside it.
function assembleContentFiles(input: BuildTwbxInput): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'index.html': typeof input.html === 'string' ? strToU8(input.html) : input.html,
  };
  for (const asset of input.assets ?? []) {
    files[asset.path] = asset.bytes;
  }
  return files;
}

// --- Renderers (string templates — no XML dep; the only care is XML-escaping interpolated values) ---

// XML-escape a value for interpolation into an attribute or text node. Apostrophe is included
// because renderTwb below uses single-quoted attributes (name='...'); a name like O'Brien would
// otherwise close the attribute early and emit malformed XML. We emit the numeric char ref &#39;
// rather than &apos; — the latter is a valid XML 1.0 entity but is rejected by some parsers (it is
// absent from the HTML predefined set), whereas &#39; is universally accepted.
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Windows-reserved filename characters: \ / : * ? " < > | (plus control chars). The published
// package is extracted on the server, so the archive base name must avoid these or the file write
// fails (a colon or slash surfaces as an HTTP 500 at publish). We replace each run with a single
// underscore, trim trailing dots/spaces (also illegal as a Windows name ending), and fall back to a
// stable default if nothing legal remains — the DISPLAY name is unaffected.
export function sanitizeFileNameBase(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned : 'workbook';
}

// Vendored 1×1 transparent PNG (the exact base64 the reader's own parser test uses).
const DEFAULT_ICON_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function renderManifest(i: BuildTwbxInput): string {
  // 4 fields, exactly the reader-test shape. version/author are provenance only (reader ignores them).
  return JSON.stringify(
    { id: i.packageId, version: '1.0.0', name: i.workbookName, author: 'Claude' },
    null,
    2,
  );
}

function renderTrex(i: BuildTwbxInput): string {
  const label = esc(i.toolbar?.label ?? i.workbookName);
  const icon = i.toolbar?.iconPngBase64 ?? DEFAULT_ICON_PNG_B64;
  // <source-location> MUST wrap the relative path in a <url> child. The server parser
  // (ExtensionXmlParser::ParseSourceLocation) reads the URL ONLY from the <url> child element
  // (GetChildText("url")); a bare-text <source-location>index.html</source-location> validates
  // against the mixed-content XSD but parses to an EMPTY url, and the package reader then rejects
  // the .trex with "This extension manifest URL () is invalid" and SKIPS the extension (the viz
  // never renders). The path stays RELATIVE ("index.html", not content/index.html): for a package
  // .trex the reader rewrites it to tableaulocalext:///<id>/content/index.html — BuildUrl already
  // inserts the content/ segment. Extension id = "<id>.toolbar".
  //
  // extension-version MUST be present and non-empty. The XSD marks it optional, but at publish time
  // the native VizQL worker registers each bundled package extension via an ExtensionKey(id, version,
  // url) and asserts ExtensionKey::IsValid() — which requires ALL THREE non-empty
  // (ExtensionRegistry::FindRegistration -> LogicAssertCustom). Omit extension-version and the parsed
  // manifest version is empty -> the assert throws a native LogicException that surfaces as an opaque
  // HTTP 403 / code 500000 ("Forbidden") on publish. Keep it aligned with the "1.0.0" the .twb render
  // chain and manifest.json already use.
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="1.0" xmlns="http://www.tableau.com/xml/extension_manifest">
  <workspace-extension id="${esc(i.packageId)}.toolbar" extension-version="1.0.0">
    <target>toolbar</target>
    <source-location><url>index.html</url></source-location>
    <toolbar-button id="x">
      <label>${label}</label>
      <icon>
        <inline>${icon}</inline>
      </icon>
      <region>primary</region>
      <on-click action="show-side-pane"/>
    </toolbar-button>
  </workspace-extension>
</manifest>`;
}

// Deterministic 32-hex-char instance id (a GUID's worth of entropy, no dashes/braces) for the
// dashboard-object's <add-in>. Deterministic ON PURPOSE: buildTwbx output must be byte-stable
// (the golden/determinism tests depend on it), so a random GUID is not an option. There is exactly
// one extension per built workbook, so instance-id only has to be unique *within* the workbook —
// trivially satisfied — while still varying by packageId so distinct workbooks differ.
function instanceIdFor(packageId: string): string {
  const fnv1a = (s: string): number => {
    let h = 0x811c9dc5;
    for (let idx = 0; idx < s.length; idx++) {
      h ^= s.charCodeAt(idx);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += fnv1a(`${i}:${packageId}`).toString(16).padStart(8, '0');
  }
  return out.toUpperCase();
}

function renderTwb(i: BuildTwbxInput): string {
  // The workbook display name doubles as the DASHBOARD name (the view the user opens) and the
  // referenced-view viewId. A placeholder "Sheet 1" worksheet is kept so <worksheets> is non-empty
  // (a workbook whose only view is an extension-hosting dashboard — exactly like WB1's Dashboard 3);
  // it is unreferenced by the dashboard and harmless.
  const name = esc(i.workbookName);
  const id = esc(i.packageId);
  // Bundled-package URL: the FULL tableaulocalext:///<id>/content/index.html form. The reader's
  // GetRuntimeExtensionUrl keeps a scheme'd URL verbatim (a bare "content/index.html" would be
  // mis-resolved with packageId="content"), so the explicit triple-slash + packageId is required.
  const url = esc(`tableaulocalext:///${i.packageId}/content/index.html`);
  const instanceId = instanceIdFor(i.packageId);
  const icon = i.toolbar?.iconPngBase64 ?? DEFAULT_ICON_PNG_B64;

  // The render chain that makes the published workbook NON-EMPTY. Three parts must agree on
  // id/version/url: (1) the dashboard-object <zone param='[id].[ver].[url]'>, (2) its <add-in>, and
  // (3) the inline <referenced-extension> dashboard-extension. Omit any and the bundled extension is
  // orphaned — which is the empty-publish bug this replaces. Modeled on WB1's verified Dashboard 3.
  return `<?xml version="1.0" encoding="utf-8"?>
<workbook version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <datasources />
  <worksheets>
    <worksheet name='Sheet 1'>
      <table><view><datasources /></view></table>
    </worksheet>
  </worksheets>
  <dashboards>
    <dashboard name='${name}'>
      <style />
      <!-- Automatic sizing: the dashboard fits the browser window instead of a fixed pixel box.
           Encodes DashboardSizingMode::Automatic (monolith DashboardSizingEncoder.cpp). min/max are
           optional for this mode (DashboardSizeOptionsParser.cpp), so we emit the bare element —
           matching real Tableau-authored automatic dashboards (e.g. PerformanceViz.twb). -->
      <size sizing-mode='automatic' />
      <zones>
        <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
          <zone forceUpdate='true' h='98000' id='3' param='[${id}].[1.0.0].[${url}]' type-v2='dashboard-object' w='98400' x='800' y='1000'>
            <add-in add-in-id='${id}' extension-url='${url}' extension-version='1.0.0' instance-id='${instanceId}'>
              <instance-settings />
              <type-settings>
                <dashboard />
              </type-settings>
            </add-in>
            <zone-style>
              <format attr='border-color' value='#444444' />
              <format attr='border-style' value='none' />
              <format attr='border-width' value='0' />
              <format attr='margin' value='4' />
            </zone-style>
          </zone>
          <zone-style>
            <format attr='border-color' value='#444444' />
            <format attr='border-style' value='none' />
            <format attr='border-width' value='0' />
            <format attr='margin' value='8' />
          </zone-style>
        </zone>
      </zones>
    </dashboard>
  </dashboards>
  <windows>
    <window class='worksheet' name='Sheet 1' />
    <window class='dashboard' maximized='true' name='${name}'>
      <viewpoints />
      <active id='3' />
    </window>
  </windows>
  <referenced-extensions>
    <referenced-extension>
      <manifest manifest-version='0.1'>
        <dashboard-extension extension-version='1.0.0' id='${id}'>
          <default-locale>en_US</default-locale>
          <name>${name}</name>
          <description>Embedded workbook extension.</description>
          <author email='noreply@tableau.com' name='Claude' organization='Tableau' website='https://www.tableau.com' />
          <min-api-version>1.4</min-api-version>
          <source-location>
            <url>${url}</url>
          </source-location>
          <icon>${icon}</icon>
        </dashboard-extension>
      </manifest>
      <referenced-views>
        <referenced-view instances='1' viewId='${name}' />
      </referenced-views>
    </referenced-extension>
  </referenced-extensions>
</workbook>`;
}

// --- Validation (§1b). Only (a) and (b) are copied product constants that can drift; both are
//     non-load-bearing. (c)/(d)/(e) are self-consistency/security/local checks that cannot drift. ---

// (d) SECURITY — hard. Structural safety on our OWN output; no external list, so it can't drift.
//     Mirrors the monolith's relative-path validation.
function assertContentPathSafe(rel: string): void {
  if (rel.startsWith('/') || rel.includes('\\')) {
    throw new BuildTwbxError(`content path '${rel}' must be relative with forward slashes`);
  }
  for (const seg of rel.split('/')) {
    if (seg === '.' || seg === '..') {
      throw new BuildTwbxError(`content path '${rel}' contains an illegal '.'/'..' segment`);
    }
  }
}

// (a) COPIED CONSTANT — NON-BLOCKING. The monolith checks extensions only at SERVE time, never at
//     publish, so a hard local reject would be STRICTER than the server. Hence: return warnings,
//     never throw. Source-of-truth: monolith PackageContentTypes.java — keep this list pinned to it.
const ALLOWED_EXT = new Set([
  'html',
  'htm',
  'js',
  'mjs',
  'css',
  'json',
  'map',
  'wasm',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'txt',
]);

export function contentExtensionWarnings(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files).flatMap((rel) => {
    const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
    return !rel.includes('.') || !ALLOWED_EXT.has(ext)
      ? [
          `content file '${rel}': extension not in the reader's serve-time allow-list (may 404 when fetched)`,
        ]
      : [];
  });
}

function validateBundle(files: Record<string, Uint8Array>): void {
  for (const rel of Object.keys(files)) {
    assertContentPathSafe(rel); // (d) hard
  }
  // (c) self-consistency — hard. The .trex's <source-location><url> relative path MUST point at a
  //     file we actually bundled. Pure internal coherence, so it can't drift.
  if (!files['index.html']) {
    throw new BuildTwbxError(
      '<source-location><url>index.html</url></source-location> has no matching content/index.html',
    );
  }
}

function validatePackageId(id: string): void {
  // (b) COPIED CONSTANT — soft fast-fail. The server re-validates this id via XSD at upload, so this
  //     is UX only. It governs the .trex id we emit as `${id}.toolbar`.
  //     Extension-Id-ST: [A-Za-z]{2,6}(\.[A-Za-z0-9-]{1,63})+ | [A-Za-z][A-Za-z0-9-]*
  //     Source-of-truth: monolith ExtensionManifest.xsd — keep pinned.
  const EXT_ID = /^[A-Za-z]{2,6}(\.[A-Za-z0-9-]{1,63})+$|^[A-Za-z][A-Za-z0-9-]*$/;
  if (!EXT_ID.test(id)) {
    throw new BuildTwbxError(`packageId '${id}' is not a legal extension id`);
  }
  // (e) local-only — hard. A cheap structural guard on our own folder name; no monolith counterpart
  //     today, so nothing to drift against.
  if (id.includes('/') || id.includes('\\') || id.endsWith('.') || id.endsWith(' ')) {
    throw new BuildTwbxError(`packageId '${id}' is not a safe directory segment`);
  }
}
