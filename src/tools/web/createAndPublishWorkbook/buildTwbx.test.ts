import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import {
  buildTwbx,
  contentExtensionWarnings,
  DataAppDatasource,
  EXTENSIONS_LIB_PATH,
  sanitizeFileNameBase,
} from './buildTwbx.js';

// Unzip a build result back into a { path: string } map so tests can assert on layout + contents
// without caring about the zip's binary framing.
function entries(bytes: Uint8Array): Record<string, string> {
  const raw = unzipSync(bytes);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strFromU8(v)]));
}

const base = {
  packageId: 'com.example.myviz',
  workbookName: 'My Viz',
  html: '<!doctype html><title>hi</title>',
};

const wcsDatasource: DataAppDatasource = {
  sqlproxyName: 'sqlproxy.abc123def456',
  contentUrl: 'WorldCupSongs',
  caption: 'World Cup Songs',
  host: 'tableau.example.com',
  port: '8080',
  field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
};

describe('buildTwbx', () => {
  it('lays out the archive: root .twb, manifest, .trex, content/index.html, and the injected lib', () => {
    const { bytes } = buildTwbx(base);
    const paths = Object.keys(entries(bytes)).sort();
    expect(paths).toEqual(
      [
        'My Viz.twb',
        'Packages/com.example.myviz/content/index.html',
        `Packages/com.example.myviz/content/${EXTENSIONS_LIB_PATH}`,
        'Packages/com.example.myviz/extensions/toolbar.trex',
        'Packages/com.example.myviz/manifest.json',
      ].sort(),
    );
  });

  it('injects a non-empty Tableau Extensions API library at the referenced path', () => {
    const files = entries(buildTwbx(base).bytes);
    const lib = files[`Packages/com.example.myviz/content/${EXTENSIONS_LIB_PATH}`];
    expect(lib.length).toBeGreaterThan(100_000);
    expect(lib).toContain('webpack');
  });

  it('names the Packages/<id>/ folder identically to the manifest id', () => {
    const files = entries(buildTwbx(base).bytes);
    const manifest = JSON.parse(files['Packages/com.example.myviz/manifest.json']);
    expect(manifest.id).toBe('com.example.myviz');
  });

  it('emits a WORKSHEET-extension (viz) .trex (id == packageId) with min-api 1.11, full data, and a <url> source', () => {
    const trex = entries(buildTwbx(base).bytes)[
      'Packages/com.example.myviz/extensions/toolbar.trex'
    ];
    expect(trex).toContain('<?xml version="1.0" encoding="utf-8"?>');
    // The manifest type MUST be a worksheet-extension (viz) to match the .twb's worksheet <add-in>
    // (type-settings/worksheet). A dashboard-extension or workspace/toolbar manifest triggers a
    // native load failure. The id must equal the add-in's add-in-id (== packageId), no ".toolbar".
    expect(trex).toContain(
      '<worksheet-extension id="com.example.myviz" extension-version="1.0.0">',
    );
    expect(trex).not.toContain('dashboard-extension');
    expect(trex).not.toContain('workspace-extension');
    expect(trex).not.toContain('<target>toolbar</target>');
    expect(trex).not.toContain('id="com.example.myviz.toolbar"');
    // A single generic <encoding id="field"> shelf is declared so the host worksheet can place one
    // field per bound datasource on it (custom-type-name='field'), which is what keeps each datasource
    // from being pruned at publish. The app still queries live (it does not read from the encoding).
    expect(trex).toContain('<encoding id="field">');
    expect(trex).toContain('<role-type>discrete-dimension</role-type>');
    // Source-location MUST wrap the relative path in a <url> child (bare text parses to an empty url).
    expect(trex).toContain('<url>index.html</url>');
    expect(trex).not.toContain('<source-location>index.html</source-location>');
    // Viz extensions / worksheetContent require min-api >= 1.11.
    expect(trex).toContain('<min-api-version>1.11</min-api-version>');
    expect(trex).toContain('<permission>full data</permission>');
  });

  it('resolves the .trex source-location to a bundled content file', () => {
    const files = entries(buildTwbx(base).bytes);
    expect(files['Packages/com.example.myviz/content/index.html']).toContain('<!doctype html>');
  });

  it('accepts raw index.html bytes without changing them', () => {
    const html = new Uint8Array([0xef, 0xbb, 0xbf, 0x00, 0x80, 0xff, 0x3c]);
    const archive = unzipSync(buildTwbx({ ...base, html }).bytes);
    expect(archive['Packages/com.example.myviz/content/index.html']).toEqual(html);
  });

  it('retains compatibility with the existing raw string caller', () => {
    const archive = unzipSync(buildTwbx(base).bytes);
    expect(strFromU8(archive['Packages/com.example.myviz/content/index.html'])).toBe(base.html);
  });

  it('never lets a workspace asset shadow the injected library', () => {
    const files = entries(
      buildTwbx({
        ...base,
        assets: [{ path: EXTENSIONS_LIB_PATH, bytes: strToU8('malicious()') }],
      }).bytes,
    );
    expect(files[`Packages/com.example.myviz/content/${EXTENSIONS_LIB_PATH}`]).not.toBe(
      'malicious()',
    );
  });

  it('binds the bundled extension to a host worksheet and wraps that worksheet in a full-screen dashboard', () => {
    // The viz model carries the full render chain on ONE worksheet: the worksheet <add-in>
    // (type-settings/worksheet), the inline <referenced-extension> worksheet-extension manifest, and a
    // <referenced-view> pointing at that worksheet. The worksheet is then embedded in a single
    // automatically-sized dashboard so the published workbook opens full-screen on the viz.
    const twb = entries(buildTwbx(base).bytes)['My Viz.twb'];
    // Host worksheet + extension chain.
    expect(twb).toContain("<worksheet name='My Viz'>");
    expect(twb).toContain("<add-in add-in-id='com.example.myviz'");
    expect(twb).toContain('<worksheet />');
    expect(twb).toContain("<worksheet-extension extension-version='1.0.0' id='com.example.myviz'>");
    // The referenced-view points at the host WORKSHEET (where the extension mounts), not the dashboard.
    expect(twb).toContain("<referenced-view instances='1' viewId='My Viz' />");
    // Full-screen dashboard wrapping it: named, automatic size, sheet title hidden, no title zone.
    expect(twb).toContain('<dashboards>');
    expect(twb).toContain("<dashboard enable-sort-zone-taborder='true' name='My Viz Dashboard'>");
    expect(twb).toContain("<size sizing-mode='automatic' />");
    expect(twb).toContain("id='3' name='My Viz' show-title='false'");
    // The dashboard window is the maximized one (its viewpoint names the embedded worksheet, and
    // <active> selects the sheet zone); the worksheet window is NOT maximized.
    expect(twb).toContain("<window class='dashboard' maximized='true' name='My Viz Dashboard'>");
    expect(twb).toContain("<viewpoint name='My Viz' />");
    expect(twb).toContain("<active id='3' />");
    expect(twb).toContain("<window class='worksheet' name='My Viz'>");
    expect(twb).not.toContain("<window class='worksheet' maximized='true' name='My Viz'>");
  });

  it('points the add-in extension-url at the FULL tableaulocalext:///<id>/content/index.html form', () => {
    const twb = entries(buildTwbx(base).bytes)['My Viz.twb'];
    const full = 'tableaulocalext:///com.example.myviz/content/index.html';
    // With no dashboard zone <param> to carry the render entry point, the worksheet <add-in>
    // extension-url itself holds the full tableaulocalext:/// URL the runtime resolves from.
    expect(twb).toContain(`extension-url='${full}'`);
    // ...and the referenced-extension source-location agrees.
    expect(twb).toContain(`<url>${full}</url>`);
  });

  it('warns (does not throw) on a content extension outside the serve-time allow-list', () => {
    const { warnings } = buildTwbx({
      ...base,
      assets: [{ path: 'data.parquet', bytes: strToU8('x') }],
    });
    expect(warnings.some((w) => w.includes('data.parquet'))).toBe(true);
    expect(contentExtensionWarnings({ 'app.js': strToU8('x') })).toEqual([]);
  });

  it('rejects a path-traversal asset (zip-slip)', () => {
    expect(() =>
      buildTwbx({ ...base, assets: [{ path: '../evil.js', bytes: strToU8('x') }] }),
    ).toThrow(BuildTwbxError);
  });

  it('rejects an illegal packageId', () => {
    expect(() => buildTwbx({ ...base, packageId: '1bad id!' })).toThrow(BuildTwbxError);
  });

  it('nests directory-prefixed asset paths under content/ verbatim (workspace-snapshot layout)', () => {
    const files = entries(
      buildTwbx({
        ...base,
        assets: [
          { path: 'src/app.js', bytes: strToU8('console.log(1)') },
          { path: 'src/styles.css', bytes: strToU8('body{}') },
        ],
      }).bytes,
    );
    expect(files['Packages/com.example.myviz/content/src/app.js']).toBe('console.log(1)');
    expect(files['Packages/com.example.myviz/content/src/styles.css']).toBe('body{}');
  });

  it('is deterministic: identical input yields byte-identical output', () => {
    const a = buildTwbx({ ...base, datasources: [wcsDatasource] }).bytes;
    const b = buildTwbx({ ...base, datasources: [wcsDatasource] }).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('sanitizes Windows-illegal chars in the .twb base name but keeps the display name verbatim', () => {
    const files = entries(buildTwbx({ ...base, workbookName: 'Q3: Sales/Ops Review' }).bytes);
    const twbPath = Object.keys(files).find((p) => p.endsWith('.twb'));
    expect(twbPath).toBe('Q3_ Sales_Ops Review.twb');
    expect(files[twbPath!]).toContain("name='Q3: Sales/Ops Review'");
  });

  it('escapes an apostrophe in the display name as &#39; (not &apos;) in the .twb XML', () => {
    const files = entries(buildTwbx({ ...base, workbookName: "O'Brien Cup" }).bytes);
    const twb = files["O'Brien Cup.twb"];
    expect(twb).toContain('&#39;');
    expect(twb).not.toContain('&apos;');
    expect(twb).toContain("name='O&#39;Brien Cup'");
  });

  describe('live datasource wiring', () => {
    const twbOf = (datasources: DataAppDatasource[]): string =>
      entries(buildTwbx({ ...base, datasources }).bytes)['My Viz.twb'];

    it('synthesizes a published-datasource (sqlproxy) reference from the binding', () => {
      const twb = twbOf([wcsDatasource]);
      expect(twb).toContain(
        "<datasource caption='World Cup Songs' inline='true' name='sqlproxy.abc123def456' version='18.1'>",
      );
      expect(twb).toContain("<repository-location id='WorldCupSongs' path='/datasources'");
      expect(twb).toContain("class='sqlproxy'");
      expect(twb).toContain("dbname='WorldCupSongs'");
      expect(twb).toContain("server='tableau.example.com'");
      expect(twb).toContain("port='8080'");
      expect(twb).toContain("server-ds-friendly-name='World Cup Songs'");
      // A minimal single-column metadata record for the placed field — NOT the full schema.
      expect(twb).toContain('<local-name>[song_title]</local-name>');
    });

    it('wires the field onto the single host worksheet that carries the extension add-in', () => {
      const twb = twbOf([wcsDatasource]);
      // The host worksheet is named after the workbook (it hosts the viz; the dashboard embeds it).
      expect(twb).toContain("<worksheet name='My Viz'>");
      // The pane mark MUST be VizExtension — the signal that mounts the extension as the sheet's viz.
      expect(twb).toContain("<mark class='VizExtension' />");
      expect(twb).not.toContain("<mark class='Automatic' />");
      // The field is placed on the extension <encodings> shelf (custom-type-name='field'), NOT on
      // <rows>/<cols> (which stay empty) — a stray rows field would trigger a native worksheet query.
      expect(twb).toContain(
        "column='[sqlproxy.abc123def456].[none:song_title:nk]' custom-type-name='field'",
      );
      expect(twb).toContain('<rows />');
      expect(twb).toContain('<cols />');
      expect(twb).not.toContain('<rows>[');
      // The viz-extension add-in lives inside the host worksheet's pane (type-settings/worksheet).
      expect(twb).toContain("<add-in add-in-id='com.example.myviz'");
      expect(twb).toContain('<worksheet />');
      // The worksheet window is NOT maximized; the dashboard window is, and its viewpoint names the sheet.
      expect(twb).toContain("<window class='worksheet' name='My Viz'>");
      expect(twb).toContain("<window class='dashboard' maximized='true' name='My Viz Dashboard'>");
      expect(twb).toContain("<viewpoint name='My Viz' />");
    });

    it('attaches every datasource to a worksheet: primary on the viz-ext host, extras on visible wire sheets (multi-datasource)', () => {
      const second: DataAppDatasource = {
        sqlproxyName: 'sqlproxy.zzz999',
        contentUrl: 'SuperstoreDatasource',
        caption: 'Superstore',
        host: 'tableau.example.com',
        port: '8080',
        field: { fieldName: 'category', caption: 'Category', dataType: 'STRING' },
      };
      const twb = twbOf([wcsDatasource, second]);
      // BOTH datasources are emitted at the workbook level (top-level <datasource inline='true'>).
      expect(twb).toContain(
        "<datasource caption='World Cup Songs' inline='true' name='sqlproxy.abc123def456'",
      );
      expect(twb).toContain(
        "<datasource caption='Superstore' inline='true' name='sqlproxy.zzz999'",
      );
      // The primary is wired into the viz-extension host worksheet via the encoding shelf.
      expect(twb).toContain("<datasource-dependencies datasource='sqlproxy.abc123def456'>");
      expect(twb).toContain(
        "column='[sqlproxy.abc123def456].[none:song_title:nk]' custom-type-name='field'",
      );
      // Each ADDITIONAL datasource must ALSO be attached to a worksheet — getAllDataSourcesAsync only
      // returns datasources used by a worksheet — so it gets its own wire worksheet with a field on Rows.
      // The window MUST be visible: a hidden worksheet is excluded from the "used by a worksheet" set,
      // which makes the datasource disappear from getAllDataSourcesAsync() at runtime (verified live).
      expect(twb).toContain("<worksheet name='Superstore'>");
      expect(twb).toContain("<datasource-dependencies datasource='sqlproxy.zzz999'>");
      expect(twb).toContain('<rows>[sqlproxy.zzz999].[none:category:nk]</rows>');
      expect(twb).toContain("<window class='worksheet' name='Superstore'>");
      expect(twb).not.toContain("<window class='worksheet' hidden='true' name='Superstore'>");
      // The wire sheet is a plain native sheet, not a second viz extension (exactly one add-in in the twb).
      expect((twb.match(/<add-in /g) ?? []).length).toBe(1);
    });

    it('maps non-string field types to the right discrete pill suffix', () => {
      const intField: DataAppDatasource = {
        ...wcsDatasource,
        field: { fieldName: 'year', caption: 'Year', dataType: 'INTEGER' },
      };
      const twb = twbOf([intField]);
      expect(twb).toContain(
        "column='[sqlproxy.abc123def456].[none:year:ok]' custom-type-name='field'",
      );
      expect(twb).toContain("datatype='integer'");
    });
  });

  describe('sanitizeFileNameBase', () => {
    it('preserves legal names including spaces, hyphens, and em-dashes', () => {
      expect(sanitizeFileNameBase('My Viz')).toBe('My Viz');
      expect(sanitizeFileNameBase('WC 2026 — Overview')).toBe('WC 2026 — Overview');
      expect(sanitizeFileNameBase('a-b_c')).toBe('a-b_c');
    });

    it('replaces each run of Windows-illegal chars with a single underscore', () => {
      expect(sanitizeFileNameBase('a:b/c')).toBe('a_b_c');
      expect(sanitizeFileNameBase('a<<>>b')).toBe('a_b');
      expect(sanitizeFileNameBase('a\\b*c?d"e|f')).toBe('a_b_c_d_e_f');
    });

    it('trims trailing dots/spaces (illegal as a Windows name ending)', () => {
      expect(sanitizeFileNameBase('report.')).toBe('report');
      expect(sanitizeFileNameBase('report ')).toBe('report');
    });

    it('falls back to a stable default when nothing legal remains', () => {
      expect(sanitizeFileNameBase(':::')).toBe('_');
      expect(sanitizeFileNameBase('')).toBe('workbook');
    });
  });
});
