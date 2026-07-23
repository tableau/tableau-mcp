// The pure, deterministic TWBX assembler for LIVE data apps. It takes an entrypoint `html` string or
// raw bytes plus content-relative `assets` (bytes) and the published-datasource bindings the app
// queries live, and emits byte-stable archive bytes. Its single feeder is the workspace-snapshot
// path (`buildWorkspaceTwbx`), which maps an immutable data-app workspace snapshot's index.html +
// sibling files straight through and reads the datasource bindings from the workspace manifest.
//
// A live data app is a bundled **dashboard extension**: index.html loads the Tableau Extensions API
// library (injected here as content/src/tableau.extensions.1.latest.js) and calls
// readMetadataAsync()/queryAsync() against the datasource(s) wired into the workbook. The extension
// can only see datasources that are used by a worksheet ON its own dashboard, so this builder emits a
// single tiny "zombie" worksheet that depends on every bound datasource and places it on the same
// dashboard as the extension object.
//
// Keep this function pure: identical input -> byte-identical output (the determinism tests rely on
// it). All non-deterministic inputs (the sqlproxy connection name, the datasource identity) are
// supplied by the caller in the bindings.

import { strToU8, zipSync } from 'fflate';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import { getTableauExtensionsLibBytes } from '../dataApps/assets/tableauExtensionsLib.js';

/** The content-relative path the injected Extensions API library is packaged at. index.html in the
 *  live scaffold references exactly this path, and the asset-reference check treats it as always
 *  provided (buildTwbx injects it; it is not stored in the per-app workspace). */
export const EXTENSIONS_LIB_PATH = 'src/tableau.extensions.1.latest.js';

/** VDS data types we map into workbook column metadata for the zombie sheet's placed field. */
export type DataAppFieldDataType = 'STRING' | 'INTEGER' | 'REAL' | 'BOOLEAN' | 'DATE' | 'DATETIME';

/** One published-datasource field placed on the zombie worksheet so the sheet "uses" the datasource
 *  (a dashboard extension only sees datasources used by a worksheet on its dashboard). */
export interface DataAppField {
  /** The logical field name WITHOUT brackets, e.g. `song_title` (from VDS `fieldName`). */
  fieldName: string;
  /** The display caption, e.g. `Song Title` (from VDS `fieldCaption`). */
  caption: string;
  /** The VDS data type; drives the workbook column metadata. */
  dataType: DataAppFieldDataType;
}

/** A published datasource the live app queries. The zombie worksheet takes a dependency on each. */
export interface DataAppDatasource {
  /** The workbook-local connection name, e.g. `sqlproxy.<hash>`. Caller-supplied for determinism. */
  sqlproxyName: string;
  /** The published datasource contentUrl. Becomes the repository-location id + connection dbname. */
  contentUrl: string;
  /** The datasource display name/caption (server-ds-friendly-name + <datasource caption>). */
  caption: string;
  /** Tableau server host (from the configured SERVER origin). */
  host: string;
  /** Tableau server port (from the configured SERVER origin; defaults applied by the caller). */
  port: string;
  /** The single field placed on the zombie sheet to make this datasource "used". */
  field: DataAppField;
}

export interface BuildTwbxInput {
  /** Reverse-domain id. Becomes BOTH the Packages/<id>/ folder name AND the manifest.json "id".
   *  Single source of truth — folder must equal id or the reader 404s the content. */
  packageId: string; // e.g. "com.example.myviz"
  workbookName: string; // .twb display name + archive base name
  html: string | Uint8Array; // index.html; strings retain compatibility, bytes are preserved exactly
  assets?: Array<{ path: string; bytes: Uint8Array }>; // extra content/ files (js, css, png…)
  /** Published datasource bindings the live app queries. When empty/omitted the workbook is built
   *  with only the extension on the dashboard (no live wiring) — a degenerate case kept so the
   *  builder never throws on a datasource-less workspace. */
  datasources?: DataAppDatasource[];
}

/** bytes = the zip; warnings = non-fatal advisories (e.g. a content extension not on the reader's
 *  serve-time allow-list). Callers surface warnings to the agent; they never block a build. */
export interface BuildTwbxResult {
  bytes: Uint8Array;
  warnings: string[];
}

export function buildTwbx(input: BuildTwbxInput): BuildTwbxResult {
  validatePackageId(input.packageId); // (b) legal Extension-Id-ST + (e) safe dir segment
  const files = assembleContentFiles(input); // content/index.html + injected lib + assets
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
    // 3) the .trex — a dashboard-extension whose <source-location><url> is index.html
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
// .trex points at; the Extensions API library is injected here (identical for every app, so it is
// NOT stored in the per-app workspace); assets land beside it.
function assembleContentFiles(input: BuildTwbxInput): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'index.html': typeof input.html === 'string' ? strToU8(input.html) : input.html,
    [EXTENSIONS_LIB_PATH]: getTableauExtensionsLibBytes(),
  };
  for (const asset of input.assets ?? []) {
    // Never let a workspace asset shadow the injected library.
    if (asset.path === EXTENSIONS_LIB_PATH) {
      continue;
    }
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
  const name = esc(i.workbookName);
  const id = esc(i.packageId);
  const icon = DEFAULT_ICON_PNG_B64;
  // A DASHBOARD extension manifest — NOT a workspace/toolbar extension. The .twb embeds this package
  // as a `type-v2='dashboard-object'` zone; the reader looks up the manifest for that object and, if
  // it finds a workspace-extension, throws a native "Cannot read properties of undefined (reading
  // 'extensionIsFirstclass')" at load. The manifest type MUST match the zone type, and the
  // dashboard-extension id MUST equal the zone's add-in-id (== packageId).
  //
  // <source-location> MUST wrap the relative path in a <url> child. The server parser reads the URL
  // ONLY from the <url> child element (GetChildText("url")); a bare-text source-location parses to an
  // empty url and the package reader rejects the .trex ("This extension manifest URL () is invalid")
  // and SKIPS the extension. The path stays RELATIVE ("index.html"): for a package .trex the reader
  // rewrites it to tableaulocalext:///<id>/content/index.html.
  //
  // extension-version MUST be present and non-empty: the native VizQL worker registers each bundled
  // package extension via an ExtensionKey(id, version, url) and asserts all three are non-empty, so
  // an empty version trips a native LogicException that surfaces as an opaque HTTP 403 on publish.
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <dashboard-extension id="${id}" extension-version="1.0.0">
    <default-locale>en_US</default-locale>
    <name resource-id="name" />
    <description>Tableau data app: queries its published datasource live via the Extensions API.</description>
    <author name="Claude" email="noreply@tableau.com" organization="Tableau" website="https://www.tableau.com" />
    <min-api-version>1.10</min-api-version>
    <source-location>
      <url>index.html</url>
    </source-location>
    <icon>${icon}</icon>
    <permissions>
      <permission>full data</permission>
    </permissions>
  </dashboard-extension>
  <resources>
    <resource id="name">
      <text locale="en_US">${name}</text>
    </resource>
  </resources>
</manifest>`;
}

// Deterministic 32-hex-char instance id (a GUID's worth of entropy, no dashes/braces) for the
// dashboard-object's <add-in>. Deterministic ON PURPOSE: buildTwbx output must be byte-stable
// (the golden/determinism tests depend on it), so a random GUID is not an option. There is exactly
// one extension per built workbook, so instance-id only has to be unique *within* the workbook —
// trivially satisfied — while still varying by packageId so distinct workbooks differ.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let idx = 0; idx < s.length; idx++) {
    h ^= s.charCodeAt(idx);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function instanceIdFor(packageId: string): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += fnv1a(`${i}:${packageId}`).toString(16).padStart(8, '0');
  }
  return out.toUpperCase();
}

// Deterministic UUID (8-4-4-4-12) derived from a seed, for the <simple-id> elements. Real Tableau
// uses random GUIDs, but the builder must be byte-stable; a per-seed deterministic UUID keeps
// distinct workbooks distinct while remaining reproducible.
function uuidFor(seed: string): string {
  const hex = (n: number): string =>
    fnv1a(n === 0 ? seed : `${seed}:${n}`)
      .toString(16)
      .padStart(8, '0');
  const h = `${hex(0)}${hex(1)}${hex(2)}${hex(3)}`.toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Per-VDS-type workbook column metadata. Only load-bearing for the tiny zombie sheet's placed field;
// the live query itself is resolved server-side by VDS from the published datasource, independent of
// this embedded metadata. `string` is the verified-golden path; others are best-effort.
function columnMeta(dataType: DataAppFieldDataType): {
  datatype: string;
  localType: string;
  remoteType: string;
  colType: string;
  defaultType: string;
  instanceSuffix: string;
} {
  switch (dataType) {
    case 'INTEGER':
      return {
        datatype: 'integer',
        localType: 'integer',
        remoteType: '20',
        colType: 'ordinal',
        defaultType: 'ordinal',
        instanceSuffix: 'ok',
      };
    case 'REAL':
      return {
        datatype: 'real',
        localType: 'real',
        remoteType: '5',
        colType: 'ordinal',
        defaultType: 'ordinal',
        instanceSuffix: 'ok',
      };
    case 'BOOLEAN':
      return {
        datatype: 'boolean',
        localType: 'boolean',
        remoteType: '11',
        colType: 'nominal',
        defaultType: 'nominal',
        instanceSuffix: 'nk',
      };
    case 'DATE':
      return {
        datatype: 'date',
        localType: 'date',
        remoteType: '7',
        colType: 'ordinal',
        defaultType: 'ordinal',
        instanceSuffix: 'ok',
      };
    case 'DATETIME':
      return {
        datatype: 'datetime',
        localType: 'datetime',
        remoteType: '7',
        colType: 'ordinal',
        defaultType: 'ordinal',
        instanceSuffix: 'ok',
      };
    case 'STRING':
    default:
      return {
        datatype: 'string',
        localType: 'string',
        remoteType: '129',
        colType: 'nominal',
        defaultType: 'nominal',
        instanceSuffix: 'nk',
      };
  }
}

// A single published-datasource reference: repository-location (keyed by contentUrl) + a sqlproxy
// connection to Data Server + one metadata-record/column for the placed field. The full column
// metadata is intentionally NOT reproduced — Tableau reconciles the schema from Data Server on load
// and VDS resolves queries server-side, so one column is sufficient for the zombie sheet to render.
function renderDatasource(ds: DataAppDatasource): string {
  const cap = esc(ds.caption);
  const sql = esc(ds.sqlproxyName);
  const cu = esc(ds.contentUrl);
  const host = esc(ds.host);
  const port = esc(ds.port);
  const fieldName = esc(ds.field.fieldName);
  const fieldCaption = esc(ds.field.caption);
  const m = columnMeta(ds.field.dataType);
  return `    <datasource caption='${cap}' inline='true' name='${sql}' version='18.1'>
      <repository-location id='${cu}' path='/datasources' revision='1.0' />
      <connection channel='http' class='sqlproxy' dbname='${cu}' directory='dataserver' port='${port}' server='${host}' server-ds-friendly-name='${cap}' username=''>
        <relation connection='${sql}' name='sqlproxy' table='[sqlproxy]' type='table' />
        <metadata-records>
          <metadata-record class='column'>
            <remote-name>${fieldName}</remote-name>
            <remote-type>${m.remoteType}</remote-type>
            <local-name>[${fieldName}]</local-name>
            <parent-name>[sqlproxy]</parent-name>
            <remote-alias>${fieldName}</remote-alias>
            <ordinal>1</ordinal>
            <local-type>${m.localType}</local-type>
            <aggregation>Count</aggregation>
            <contains-null>true</contains-null>
          </metadata-record>
        </metadata-records>
      </connection>
      <column aggregation='Count' caption='${fieldCaption}' datatype='${m.datatype}' default-type='${m.defaultType}' name='[${fieldName}]' role='dimension' type='${m.colType}' />
    </datasource>`;
}

// The single tiny "zombie" worksheet. It references every bound datasource and places one discrete
// field from each so each datasource is genuinely "used" (and therefore visible to the dashboard
// extension via getAllDataSourcesAsync). The first datasource is the primary; the sheet's only job
// is to make the datasources present on the dashboard, so its visual is irrelevant.
function renderZombieWorksheet(datasources: DataAppDatasource[], seed: string): string {
  const deps = datasources
    .map((ds) => {
      const m = columnMeta(ds.field.dataType);
      const fieldName = esc(ds.field.fieldName);
      const fieldCaption = esc(ds.field.caption);
      const sql = esc(ds.sqlproxyName);
      return `          <datasource-dependencies datasource='${sql}'>
            <column aggregation='Count' caption='${fieldCaption}' datatype='${m.datatype}' default-type='${m.defaultType}' layered='true' name='[${fieldName}]' role='dimension' type='${m.colType}' />
            <column-instance column='[${fieldName}]' derivation='None' name='[none:${fieldName}:${m.instanceSuffix}]' pivot='key' type='${m.colType}' />
          </datasource-dependencies>`;
    })
    .join('\n');

  const dsRefs = datasources
    .map(
      (ds) =>
        `            <datasource caption='${esc(ds.caption)}' name='${esc(ds.sqlproxyName)}' />`,
    )
    .join('\n');

  // Primary datasource's field on rows gives the sheet a real visual representation (required — a
  // dashboard zone referencing a sheet with no visual fails publish with "no visual representation").
  const primary = datasources[0];
  const pm = columnMeta(primary.field.dataType);
  const rows = `[${esc(primary.sqlproxyName)}].[none:${esc(primary.field.fieldName)}:${pm.instanceSuffix}]`;

  return `    <worksheet name='Sheet 1'>
      <table>
        <view>
          <datasources>
${dsRefs}
          </datasources>
${deps}
          <aggregation value='true' />
        </view>
        <style />
        <panes>
          <pane selection-relaxation-option='selection-relaxation-allow'>
            <view>
              <breakdown value='auto' />
            </view>
            <mark class='Automatic' />
          </pane>
        </panes>
        <rows>${rows}</rows>
        <cols />
      </table>
      <simple-id uuid='{${uuidFor(`${seed}:ws`)}}' />
    </worksheet>`;
}

// A worksheet window carries the "visual representation" the publish validator requires for any
// sheet a dashboard references. Cards are standard shelf layout; datasource-independent boilerplate.
function renderWorksheetWindow(seed: string): string {
  return `    <window class='worksheet' name='Sheet 1'>
      <cards>
        <edge name='left'>
          <strip size='160'>
            <card type='pages' />
            <card type='filters' />
            <card type='marks' />
          </strip>
        </edge>
        <edge name='top'>
          <strip size='31'>
            <card type='columns' />
          </strip>
          <strip size='31'>
            <card type='rows' />
          </strip>
          <strip size='31'>
            <card type='title' />
          </strip>
        </edge>
      </cards>
      <simple-id uuid='{${uuidFor(`${seed}:wswin`)}}' />
    </window>`;
}

function renderTwb(i: BuildTwbxInput): string {
  const name = esc(i.workbookName);
  const id = esc(i.packageId);
  // Bundled-package URL: the FULL tableaulocalext:///<id>/content/index.html form. The reader's
  // GetRuntimeExtensionUrl keeps a scheme'd URL verbatim (a bare "content/index.html" would be
  // mis-resolved with packageId="content"), so the explicit triple-slash + packageId is required.
  const url = esc(`tableaulocalext:///${i.packageId}/content/index.html`);
  const instanceId = instanceIdFor(i.packageId);
  const icon = DEFAULT_ICON_PNG_B64;
  const datasources = i.datasources ?? [];
  const hasData = datasources.length > 0;

  // With live datasources: emit the datasource blocks + the single zombie worksheet, and put BOTH
  // the zombie sheet zone and the extension dashboard-object zone on the dashboard. Without them
  // (degenerate case): emit only the extension on the dashboard plus an unreferenced placeholder
  // worksheet so <worksheets> is non-empty.
  const datasourcesXml = hasData
    ? `  <datasources>
${datasources.map(renderDatasource).join('\n')}
  </datasources>`
    : '  <datasources />';

  const worksheetsXml = hasData
    ? `  <worksheets>
${renderZombieWorksheet(datasources, i.packageId)}
  </worksheets>`
    : `  <worksheets>
    <worksheet name='Sheet 1'>
      <table><view><datasources /></view></table>
    </worksheet>
  </worksheets>`;

  // The extension dashboard-object zone. When there is a zombie sheet, it is tucked into a narrow
  // strip on the left (w small) and the extension takes the rest, so the sheet never distracts.
  const extZone = `          <zone forceUpdate='true' h='98000' id='3' param='[${id}].[1.0.0].[${url}]' type-v2='dashboard-object' w='${hasData ? '96000' : '98400'}' x='${hasData ? '3000' : '800'}' y='1000'>
            <add-in add-in-id='${id}' extension-url='${id}/content/index.html' extension-version='1.0.0' instance-id='${instanceId}'>
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
          </zone>`;

  // The zombie sheet zone: a very small (w='1500') strip so it is present on the dashboard (required
  // for the extension to see the datasource) without distracting from the app.
  const zombieZone = hasData
    ? `
          <zone h='98000' id='5' name='Sheet 1' w='1500' x='800' y='1000'>
            <zone-style>
              <format attr='border-color' value='#444444' />
              <format attr='border-style' value='none' />
              <format attr='border-width' value='0' />
              <format attr='margin' value='4' />
            </zone-style>
          </zone>`
    : '';

  const viewpointsXml = hasData
    ? `      <viewpoints>
        <viewpoint name='Sheet 1' />
      </viewpoints>
      <active id='-1' />`
    : `      <viewpoints />
      <active id='3' />`;

  const worksheetWindowXml = hasData ? `\n${renderWorksheetWindow(i.packageId)}` : '';

  // The render chain that makes the published workbook NON-EMPTY. Three parts must agree on
  // id/version/url: (1) the dashboard-object <zone param='[id].[ver].[url]'>, (2) its <add-in>, and
  // (3) the inline <referenced-extension> dashboard-extension. Omit any and the bundled extension is
  // orphaned. The referenced-extension manifest is a dashboard-extension to match the zone type.
  return `<?xml version='1.0' encoding='utf-8'?>
<workbook version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
${datasourcesXml}
${worksheetsXml}
  <dashboards>
    <dashboard name='${name}'>
      <style />
      <!-- Automatic sizing: the dashboard fits the browser window instead of a fixed pixel box. -->
      <size sizing-mode='automatic' />
      <zones>
        <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
${extZone}${zombieZone}
          <zone-style>
            <format attr='border-color' value='#444444' />
            <format attr='border-style' value='none' />
            <format attr='border-width' value='0' />
            <format attr='margin' value='8' />
          </zone-style>
        </zone>
      </zones>
      <simple-id uuid='{${uuidFor(`${i.packageId}:dash`)}}' />
    </dashboard>
  </dashboards>
  <windows>${worksheetWindowXml}
    <window class='dashboard' maximized='true' name='${name}'>
${viewpointsXml}
      <simple-id uuid='{${uuidFor(`${i.packageId}:dashwin`)}}' />
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
          <min-api-version>1.10</min-api-version>
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
  //     is UX only. It governs the dashboard-extension id we emit (== packageId).
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
