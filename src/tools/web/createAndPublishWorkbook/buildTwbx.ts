// The pure, deterministic TWBX assembler for LIVE data apps. It takes an entrypoint `html` string or
// raw bytes plus content-relative `assets` (bytes) and the published-datasource bindings the app
// queries live, and emits byte-stable archive bytes. Its single feeder is the workspace-snapshot
// path (`buildWorkspaceTwbx`), which maps an immutable data-app workspace snapshot's index.html +
// sibling files straight through and reads the datasource bindings from the workspace manifest.
//
// A live data app is a bundled **viz (worksheet) extension**: index.html loads the Tableau Extensions
// API library (injected here as content/src/tableau.extensions.1.latest.js) and calls
// readMetadataAsync()/queryAsync() against the datasource(s) wired into the workbook. A viz extension
// is hosted directly on a worksheet (tableau.extensions.worksheetContent.worksheet) and can reach
// every datasource in the workbook via tableau.extensions.workbook.getAllDataSourcesAsync(). This
// builder emits a single host worksheet that (a) sets its pane's <mark class='VizExtension'/> — the
// signal that makes Tableau MOUNT the extension as the sheet's viz (without it the server treats the
// sheet as an ordinary, empty worksheet and never loads the extension iframe), (b) carries the
// viz-extension add-in in that pane, and (c) wires in the PRIMARY datasource by placing one field on
// the extension's <encodings> shelf (NOT on <rows>/<cols>, which stay empty) so the pane has a valid
// host viz. Each ADDITIONAL datasource gets its own HIDDEN anchor worksheet (renderAnchorWorksheet):
// a worksheet can attach only one datasource without a blend (multi-DS-per-sheet is what Tableau REST
// rejects with HTTP 400 on publish), AND getAllDataSourcesAsync() only returns datasources ATTACHED to
// some worksheet (a datasource merely carried in the workbook is invisible to the extension at runtime,
// verified empirically) — so every datasource needs exactly one attaching worksheet, and the anchors'
// tabs are hidden so they don't clutter the app. The shape mirrors a Tableau-authored viz-extension
// workbook (verified against a real Sankey-extension .twb). No dashboard needed.
//
// Keep this function pure: identical input -> byte-identical output (the determinism tests rely on
// it). All non-deterministic inputs (the sqlproxy connection name, the datasource identity) are
// supplied by the caller in the bindings.

import { strToU8, zipSync } from 'fflate';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import { getTableauExtensionsLibBytes } from '../dataApps/assets/tableauExtensionsLib.js';

// Fixed archive entry timestamp so zip output is byte-stable across runs (fflate defaults to Date.now()).
// Mid-range UTC instant: safe from any local-timezone shift out of fflate's 1980–2099 range.
const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1, 12, 0, 0));

/** The content-relative path the injected Extensions API library is packaged at. index.html in the
 *  live scaffold references exactly this path, and the asset-reference check treats it as always
 *  provided (buildTwbx injects it; it is not stored in the per-app workspace). */
export const EXTENSIONS_LIB_PATH = 'src/tableau.extensions.1.latest.js';

/** VDS data types we map into workbook column metadata for the host sheet's placed field. */
export type DataAppFieldDataType = 'STRING' | 'INTEGER' | 'REAL' | 'BOOLEAN' | 'DATE' | 'DATETIME';

/** One published-datasource field placed on the host worksheet's viz-extension <encodings> shelf so
 *  the sheet "uses" the datasource (otherwise Tableau prunes any datasource no sheet references, and
 *  the live app could not query it via workbook.getAllDataSourcesAsync()). */
export interface DataAppField {
  /** The logical field name WITHOUT brackets, e.g. `song_title` (from VDS `fieldName`). */
  fieldName: string;
  /** The display caption, e.g. `Song Title` (from VDS `fieldCaption`). */
  caption: string;
  /** The VDS data type; drives the workbook column metadata. */
  dataType: DataAppFieldDataType;
}

/** A published datasource the live app queries. The host worksheet takes a dependency on each. */
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
  /** The single field placed on the host sheet's viz-extension encoding to make this datasource "used". */
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
   *  with only the extension on its host worksheet (no live wiring) — a degenerate case kept so the
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
    // 3) the .trex — a worksheet-extension (viz) whose <source-location><url> is index.html
    [`Packages/${id}/extensions/toolbar.trex`]: strToU8(renderTrex(input)),
    // 4) content/*
    ...Object.fromEntries(
      Object.entries(files).map(([rel, bytes]) => [`Packages/${id}/content/${rel}`, bytes]),
    ),
  };

  // fflate stamps each entry's mtime with Date.now() by default, which would make raw-zip bytes vary
  // run-to-run (the golden tests unzip and compare CONTENT so they're immune, but the determinism test
  // compares raw bytes). Pin a fixed mtime so the output is genuinely byte-stable. The value is a
  // mid-range UTC instant so no local timezone can shift it outside fflate's supported 1980–2099 range.
  return { bytes: zipSync(zip, { level: 6, mtime: FIXED_MTIME }), warnings };
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
  // A VIZ (worksheet) extension manifest — root element <worksheet-extension> (NOT dashboard-extension
  // and NOT a workspace/toolbar extension). The .twb hosts this package on a worksheet via an
  // <add-in> in the worksheet's <pane> with <type-settings><worksheet/></type-settings>; the reader
  // looks up the manifest for that add-in and the manifest type MUST match (worksheet). The
  // worksheet-extension id MUST equal the add-in's add-in-id (== packageId).
  //
  // A single generic <encoding id="field"> shelf IS declared. The app does not read data FROM the
  // encoding at runtime (it queries live via workbook.getAllDataSourcesAsync() + queryAsync()); the
  // shelf exists solely so the host worksheet can PLACE one field per bound datasource on it (see
  // renderHostWorksheet), which is what keeps each datasource from being pruned at publish. Every
  // placed <custom custom-type-name="field"> in the .twb must correspond to a declared encoding id,
  // matching how a real Tableau-authored viz extension (e.g. Sankey: level/edge) serializes.
  //
  // min-api-version MUST be >= 1.11 — viz extensions and the worksheetContent namespace were
  // introduced at 1.11 (a lower value makes the host reject the extension as not viz-capable).
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
  <worksheet-extension id="${id}" extension-version="1.0.0">
    <default-locale>en_US</default-locale>
    <name resource-id="name" />
    <description>Tableau data app: queries its published datasource live via the Extensions API.</description>
    <author name="Claude" email="noreply@tableau.com" organization="Tableau" website="https://www.tableau.com" />
    <min-api-version>1.11</min-api-version>
    <source-location>
      <url>index.html</url>
    </source-location>
    <icon>${icon}</icon>
    <permissions>
      <permission>full data</permission>
    </permissions>
    <encoding id="field">
      <display-name>Data</display-name>
      <role-spec>
        <role-type>discrete-dimension</role-type>
        <role-type>discrete-measure</role-type>
        <role-type>continuous-dimension</role-type>
        <role-type>continuous-measure</role-type>
      </role-spec>
      <fields max-count="50" />
      <encoding-icon token="level" />
    </encoding>
  </worksheet-extension>
  <resources>
    <resource id="name">
      <text locale="en_US">${name}</text>
    </resource>
  </resources>
</manifest>`;
}

// Deterministic 32-hex-char instance id (a GUID's worth of entropy, no dashes/braces) for the
// host worksheet's viz-extension <add-in>. Deterministic ON PURPOSE: buildTwbx output must be byte-stable
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

// Per-VDS-type workbook column metadata. Only load-bearing for the host sheet's placed field;
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
// and VDS resolves queries server-side, so one column is sufficient for the host sheet to render.
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
      <connection channel='http' class='sqlproxy' composed-connection-name='${sql}' dbname='${cu}' directory='dataserver' port='${port}' server='${host}' server-ds-friendly-name='${cap}' username=''>
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

// The viz-extension <add-in>, placed inside the host worksheet's <pane>. Its add-in-id MUST equal
// the packageId (== the worksheet-extension manifest id) and its type-settings MUST be <worksheet/>
// (matching the worksheet-extension manifest — a <dashboard/> here trips a native load error).
// extension-url carries the FULL tableaulocalext:/// form: without a dashboard zone <param> to hold
// it, the add-in itself is the only place the runtime resolves the bundled content URL from.
function renderAddIn(id: string, url: string, instanceId: string): string {
  return `            <add-in add-in-id='${id}' extension-url='${url}' extension-version='1.0.0' instance-id='${instanceId}'>
              <instance-settings />
              <type-settings>
                <worksheet />
              </type-settings>
            </add-in>`;
}

// The single host worksheet. It (a) sets <mark class='VizExtension'/> — the signal that makes Tableau
// mount the add-in as the sheet's viz — (b) carries the viz-extension add-in in its pane, and (c)
// wires in ONLY the PRIMARY datasource (datasources[0]) by placing one field on the extension's
// <encodings> shelf (custom-type-name='field', matching the manifest's <encoding id='field'>). The
// field goes on the encoding, NOT on <rows>/<cols> (which stay empty): a VizExtension pane is driven
// by encodings, and a stray field on rows would trigger a native worksheet query (the DataServiceFailure
// path).
//
// IMPORTANT — multi-datasource: a single worksheet can reference at most ONE datasource without a
// blend relationship; wiring 2+ datasources into one worksheet emits invalid blend XML that Tableau
// REST rejects with a bare HTTP 400 on publish. So ADDITIONAL datasources are NOT wired into this
// worksheet — each gets its own hidden anchor worksheet (see renderAnchorWorksheet), because
// getAllDataSourcesAsync() only returns datasources attached to a worksheet. This host wires just the
// primary; its single encoding is only there so the extension has a valid, mountable host viz.
function renderHostWorksheet(
  datasources: DataAppDatasource[],
  seed: string,
  sheetName: string,
  addInXml: string,
): string {
  const name = esc(sheetName);

  // Degenerate case (no datasources): just the worksheet hosting the add-in. Real apps always bind
  // at least one datasource; this path only exists so the builder never throws.
  if (datasources.length === 0) {
    return `    <worksheet name='${name}'>
      <table>
        <view>
          <datasources />
        </view>
        <style />
        <panes>
          <pane selection-relaxation-option='selection-relaxation-allow'>
            <view>
              <breakdown value='auto' />
            </view>
            <mark class='VizExtension' />
${addInXml}
          </pane>
        </panes>
        <rows />
        <cols />
      </table>
      <simple-id uuid='{${uuidFor(`${seed}:ws`)}}' />
    </worksheet>`;
  }

  // Only the PRIMARY datasource is wired into the host worksheet (a worksheet cannot reference >1
  // datasource without a blend). Additional datasources ride along at the workbook level, unattached.
  const primary = datasources[0];
  const pm = columnMeta(primary.field.dataType);
  const pFieldName = esc(primary.field.fieldName);
  const pFieldCaption = esc(primary.field.caption);
  const pSql = esc(primary.sqlproxyName);

  const deps = `          <datasource-dependencies datasource='${pSql}'>
            <column aggregation='Count' caption='${pFieldCaption}' datatype='${pm.datatype}' default-type='${pm.defaultType}' layered='true' name='[${pFieldName}]' role='dimension' type='${pm.colType}' />
            <column-instance column='[${pFieldName}]' derivation='None' name='[none:${pFieldName}:${pm.instanceSuffix}]' pivot='key' type='${pm.colType}' />
          </datasource-dependencies>`;

  const dsRefs = `            <datasource caption='${esc(primary.caption)}' name='${pSql}' />`;

  // A single field on the viz-extension encoding shelf, referencing the primary's column-instance
  // declared in <datasource-dependencies> above; custom-type-name='field' matches the manifest's
  // <encoding id='field'>. The extension renders via its own live queries; this placement only gives
  // the pane a valid host viz so the extension mounts.
  const encId = uuidFor(`${seed}:enc:${primary.sqlproxyName}`);
  const encodings = `            <custom encoding-id='{${encId}}' column='[${pSql}].[none:${pFieldName}:${pm.instanceSuffix}]' custom-type-name='field' />`;

  return `    <worksheet name='${name}'>
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
            <mark class='VizExtension' />
${addInXml}
            <encodings>
${encodings}
            </encodings>
          </pane>
        </panes>
        <rows />
        <cols />
      </table>
      <simple-id uuid='{${uuidFor(`${seed}:ws`)}}' />
    </worksheet>`;
}

// A "wire" worksheet for an ADDITIONAL (non-primary) datasource. Its only job is to make the datasource
// "used" by a worksheet — at runtime tableau.extensions.workbook.getAllDataSourcesAsync() returns ONLY
// datasources referenced by at least one worksheet (a datasource merely present in the workbook data
// pane is invisible to the extension; verified empirically). A worksheet can attach exactly one
// datasource without a blend, so each additional datasource needs its own wire sheet. The "minimum
// shape that counts as used" is: a <datasources> block naming it, a <datasource-dependencies> block,
// and at least one real column-instance on <rows>. The wire sheet is a plain native sheet (mark
// Automatic, NOT a viz extension) and its tab is VISIBLE — a hidden window is excluded from the
// "used by a worksheet" enumeration, so hiding it makes the datasource disappear from the extension.
function renderAnchorWorksheet(ds: DataAppDatasource, seed: string): string {
  const m = columnMeta(ds.field.dataType);
  const name = esc(ds.caption);
  const sql = esc(ds.sqlproxyName);
  const fieldName = esc(ds.field.fieldName);
  const fieldCaption = esc(ds.field.caption);
  const rows = `[${sql}].[none:${fieldName}:${m.instanceSuffix}]`;
  return `    <worksheet name='${name}'>
      <table>
        <view>
          <datasources>
            <datasource caption='${name}' name='${sql}' />
          </datasources>
          <datasource-dependencies datasource='${sql}'>
            <column aggregation='Count' caption='${fieldCaption}' datatype='${m.datatype}' default-type='${m.defaultType}' layered='true' name='[${fieldName}]' role='dimension' type='${m.colType}' />
            <column-instance column='[${fieldName}]' derivation='None' name='[none:${fieldName}:${m.instanceSuffix}]' pivot='key' type='${m.colType}' />
          </datasource-dependencies>
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
      <simple-id uuid='{${uuidFor(`${seed}:anchor:${ds.sqlproxyName}`)}}' />
    </worksheet>`;
}

// The window for a wire worksheet. It MUST be visible (no hidden='true') — a hidden worksheet is
// excluded from getAllDataSourcesAsync()'s "used by a worksheet" enumeration, which defeats the wire
// sheet's whole purpose. Standard cards; not maximized (the host worksheet is the maximized/default).
function renderAnchorWindow(ds: DataAppDatasource, seed: string): string {
  return `    <window class='worksheet' name='${esc(ds.caption)}'>
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
      <simple-id uuid='{${uuidFor(`${seed}:anchorwin:${ds.sqlproxyName}`)}}' />
    </window>`;
}

// The host worksheet's window. Maximized so the published workbook opens straight onto the
// viz-extension sheet. Cards are standard shelf layout; boilerplate.
function renderWorksheetWindow(seed: string, sheetName: string): string {
  return `    <window class='worksheet' maximized='true' name='${esc(sheetName)}'>
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

  // The host worksheet's display name IS the published view name (there is no dashboard), so it is
  // the workbook name. The referenced-view viewId below MUST match it.
  const addInXml = renderAddIn(id, url, instanceId);

  const datasourcesXml = hasData
    ? `  <datasources>
${datasources.map(renderDatasource).join('\n')}
  </datasources>`
    : '  <datasources />';

  // Host worksheet (viz extension on the primary datasource) + one hidden anchor worksheet per
  // ADDITIONAL datasource so every datasource is attached to a worksheet and therefore reachable via
  // getAllDataSourcesAsync() at runtime.
  const anchorDatasources = datasources.slice(1);
  const anchorWorksheets = anchorDatasources
    .map((ds) => renderAnchorWorksheet(ds, i.packageId))
    .join('\n');
  const worksheetsXml = `  <worksheets>
${renderHostWorksheet(datasources, i.packageId, i.workbookName, addInXml)}${
    anchorWorksheets ? `\n${anchorWorksheets}` : ''
  }
  </worksheets>`;

  const anchorWindows = anchorDatasources
    .map((ds) => renderAnchorWindow(ds, i.packageId))
    .join('\n');

  // The render chain that makes the published workbook a valid viz-extension app. Three parts must
  // agree on id/version/url: (1) the host worksheet's <add-in>, (2) the inline <referenced-extension>
  // worksheet-extension manifest, and (3) its <source-location><url>. The referenced-extension
  // manifest is a worksheet-extension (viz) to match the add-in's <type-settings><worksheet/></> —
  // a dashboard-extension here would orphan the bundled content. The <referenced-view viewId> points
  // at the host worksheet (the only view; no dashboard).
  return `<?xml version='1.0' encoding='utf-8'?>
<workbook version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
${datasourcesXml}
${worksheetsXml}
  <windows>
${renderWorksheetWindow(i.packageId, i.workbookName)}${anchorWindows ? `\n${anchorWindows}` : ''}
  </windows>
  <referenced-extensions>
    <referenced-extension>
      <manifest manifest-version='0.1'>
        <worksheet-extension extension-version='1.0.0' id='${id}'>
          <default-locale>en_US</default-locale>
          <name>${name}</name>
          <description>Embedded workbook extension.</description>
          <author email='noreply@tableau.com' name='Claude' organization='Tableau' website='https://www.tableau.com' />
          <min-api-version>1.11</min-api-version>
          <source-location>
            <url>${url}</url>
          </source-location>
          <icon>${icon}</icon>
          <permissions>
            <permission>full data</permission>
          </permissions>
          <encoding id='field'>
            <display-name>Data</display-name>
            <role-spec>
              <role-type>discrete-dimension</role-type>
              <role-type>discrete-measure</role-type>
              <role-type>continuous-dimension</role-type>
              <role-type>continuous-measure</role-type>
            </role-spec>
            <fields max-count='50' />
            <encoding-icon token='level' />
          </encoding>
        </worksheet-extension>
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
  //     is UX only. It governs the worksheet-extension id we emit (== packageId).
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
