import { strToU8, zipSync } from 'fflate';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';

export interface BuildTwbxInput {
  /** Reverse-domain id. Becomes BOTH the Packages/<id>/ folder name AND the manifest.json "id".
   *  Single source of truth — folder must equal id or the reader 404s the content. */
  packageId: string; // e.g. "com.example.myviz"
  workbookName: string; // .twb display name + archive base name
  html: string; // Claude's index.html (the extension entrypoint)
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
    [`${fileBase}.twb`]: strToU8(renderTwb(input.workbookName)),
    // 2) manifest.json — its "id" MUST equal the Packages/<id>/ folder name
    [`Packages/${id}/manifest.json`]: strToU8(renderManifest(input)),
    // 3) the .trex — bare-relative <source-location>index.html</source-location>
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
    'index.html': strToU8(input.html),
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
  // <source-location> is a BARE RELATIVE path; the platform rewrites it to
  // tableaulocalext:///<id>/content/index.html at load time. Extension id = "<id>.toolbar".
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="1.0" xmlns="http://www.tableau.com/xml/extension_manifest">
  <workspace-extension id="${esc(i.packageId)}.toolbar">
    <target>toolbar</target>
    <source-location>index.html</source-location>
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

function renderTwb(name: string): string {
  // Minimal single-worksheet shell. No package reference needed: publish associates by workbook_id.
  // Deferred: real <datasources>. See the doc's Phase-4 caveat — fall back to vendored SDMWorkbook.twb
  // if the publish pipeline rejects this minimized form.
  return `<?xml version="1.0" encoding="utf-8"?>
<workbook version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <datasources />
  <worksheets>
    <worksheet name='${esc(name)}'>
      <table><view><datasources /></view></table>
    </worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='${esc(name)}' />
  </windows>
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
  // (c) self-consistency — hard. The .trex's bare-relative <source-location> MUST point at a file we
  //     actually bundled. Pure internal coherence, so it can't drift.
  if (!files['index.html']) {
    throw new BuildTwbxError(
      '<source-location>index.html</source-location> has no matching content/index.html',
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
