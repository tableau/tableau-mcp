import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import { buildTwbx, contentExtensionWarnings, sanitizeFileNameBase } from './buildTwbx.js';

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

describe('buildTwbx', () => {
  it('lays out the archive: root .twb, manifest, .trex, and content/index.html', () => {
    const { bytes } = buildTwbx(base);
    const paths = Object.keys(entries(bytes)).sort();
    expect(paths).toEqual(
      [
        'My Viz.twb',
        'Packages/com.example.myviz/content/index.html',
        'Packages/com.example.myviz/extensions/toolbar.trex',
        'Packages/com.example.myviz/manifest.json',
      ].sort(),
    );
  });

  it('names the Packages/<id>/ folder identically to the manifest id', () => {
    const files = entries(buildTwbx(base).bytes);
    const manifest = JSON.parse(files['Packages/com.example.myviz/manifest.json']);
    expect(manifest.id).toBe('com.example.myviz');
    // Folder segment and manifest.id are the same string — the reader keys content resolution on it.
    expect(files['Packages/com.example.myviz/manifest.json']).toBeDefined();
  });

  it('emits a well-formed .trex whose extension id is <id>.toolbar with a <url>-wrapped relative source-location', () => {
    const trex = entries(buildTwbx(base).bytes)[
      'Packages/com.example.myviz/extensions/toolbar.trex'
    ];
    expect(trex).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(trex).toContain('id="com.example.myviz.toolbar"');
    // The server parser reads the URL ONLY from the <url> CHILD element. A bare-text
    // <source-location>index.html</source-location> parses to an empty url and is rejected
    // ("This extension manifest URL () is invalid"), so the path MUST be wrapped in <url>.
    expect(trex).toContain('<url>index.html</url>');
    expect(trex).not.toContain('<source-location>index.html</source-location>');
    expect(trex).toContain('<target>toolbar</target>');
    // extension-version MUST be present and non-empty on the workspace-extension. It is OPTIONAL in
    // the XSD, so a versionless .trex passes publish-time schema validation — but the native VizQL
    // worker then builds an ExtensionKey(id, version, url) and asserts all three are non-empty. An
    // empty version trips a native LogicException that surfaces as an opaque HTTP 403 on publish.
    expect(trex).toMatch(/<workspace-extension\b[^>]*\bextension-version="[^"]+"/);
  });

  it('resolves the .trex source-location to a bundled content file', () => {
    // index.html is always bundled, so a build with only html succeeds. Removing it is impossible
    // via the public input, so this asserts the happy path that the (c) check guards.
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

  it('binds the bundled extension to a dashboard so the published workbook is NOT empty', () => {
    // Regression guard for the empty-publish bug: the .twb must carry the full render chain —
    // a dashboard, a dashboard-object zone, an <add-in>, and an inline <referenced-extension> —
    // or the bundled package is orphaned and the workbook publishes blank.
    const twb = entries(buildTwbx(base).bytes)['My Viz.twb'];
    expect(twb).toContain('<dashboards>');
    expect(twb).toContain("<dashboard name='My Viz'>");
    expect(twb).toContain("type-v2='dashboard-object'");
    expect(twb).toContain("<add-in add-in-id='com.example.myviz'");
    expect(twb).toContain("<dashboard-extension extension-version='1.0.0' id='com.example.myviz'>");
    // referenced-view viewId must equal the dashboard name so the extension binds to that view.
    expect(twb).toContain("<referenced-view instances='1' viewId='My Viz' />");
    // A dashboard window (not merely a lone worksheet window) so the view opens on the dashboard.
    expect(twb).toContain("<window class='dashboard'");
  });

  it('sizes the dashboard as automatic (fit-to-window) rather than a fixed pixel box', () => {
    // The dashboard must fill the browser window, not render as a fixed 1000×800 box. In the .twb
    // schema that is the <size sizing-mode='automatic' /> element (DashboardSizingMode::Automatic).
    // Source of truth: monolith DashboardSizingEncoder.cpp maps Automatic → 'automatic', and the
    // parser (DashboardSizeOptionsParser.cpp) treats min/max as optional — a bare
    // <size sizing-mode='automatic' /> decodes cleanly to Automatic. Verified against the real
    // Tableau-authored fixture PerformanceViz.twb, whose automatic dashboards emit exactly this.
    const twb = entries(buildTwbx(base).bytes)['My Viz.twb'];
    expect(twb).toContain("<size sizing-mode='automatic' />");
    // And NOT the old fixed-size form (equal min==max with no sizing-mode → parsed as fixed).
    expect(twb).not.toContain('maxheight=');
    expect(twb).not.toContain('minwidth=');
    // The outer layout zone still spans the full 100000×100000 canvas so content fills the dashboard.
    expect(twb).toContain("type-v2='layout-basic' w='100000'");
  });

  it('points the render chain at the FULL tableaulocalext:///<id>/content/index.html form', () => {
    // The reader keeps a scheme'd URL verbatim; a bare "content/index.html" would mis-resolve with
    // packageId="content". All three chain sites (zone param, add-in extension-url, referenced-
    // extension <url>) must carry the explicit triple-slash + packageId.
    const twb = entries(buildTwbx(base).bytes)['My Viz.twb'];
    const url = 'tableaulocalext:///com.example.myviz/content/index.html';
    expect(twb).toContain(`param='[com.example.myviz].[1.0.0].[${url}]'`);
    expect(twb).toContain(`extension-url='${url}'`);
    expect(twb).toContain(`<url>${url}</url>`);
    // Never emit a bare-relative source in the .twb render chain.
    expect(twb).not.toContain("extension-url='content/index.html'");
  });

  it('warns (does not throw) on a content extension outside the serve-time allow-list', () => {
    const { warnings } = buildTwbx({
      ...base,
      assets: [{ path: 'data.parquet', bytes: strToU8('x') }],
    });
    expect(warnings.some((w) => w.includes('data.parquet'))).toBe(true);
    // A file with an allowed extension produces no warning.
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
    // The workspace-snapshot path (buildWorkspaceTwbx) maps files like src/app.js / src/styles.css
    // straight through as assets; buildTwbx must place each under content/<path> preserving the
    // subdirectory, not flatten it.
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
    const a = buildTwbx(base).bytes;
    const b = buildTwbx(base).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('sanitizes Windows-illegal chars in the .twb base name but keeps the display name verbatim', () => {
    // A colon/slash in the name is illegal in a Windows filename (the server extracts the package
    // to disk → publish 500 if left raw). The .twb ENTRY must be sanitized; the worksheet/window
    // display name inside the XML must stay exactly as given.
    const files = entries(buildTwbx({ ...base, workbookName: 'Q3: Sales/Ops Review' }).bytes);
    const twbPath = Object.keys(files).find((p) => p.endsWith('.twb'));
    expect(twbPath).toBe('Q3_ Sales_Ops Review.twb');
    // Display name preserved verbatim (spaces kept, illegal chars intact) in the worksheet element.
    expect(files[twbPath!]).toContain("name='Q3: Sales/Ops Review'");
  });

  it('escapes an apostrophe in the display name as &#39; (not &apos;) in the .twb XML', () => {
    // &apos; is valid XML 1.0 but the Tableau publish parser rejects it (400). &#39; is universal.
    // An apostrophe is a LEGAL Windows filename char, so the .twb base name keeps it verbatim; only
    // the XML-interpolated display name is escaped.
    const files = entries(buildTwbx({ ...base, workbookName: "O'Brien Cup" }).bytes);
    const twb = files["O'Brien Cup.twb"];
    expect(twb).toContain('&#39;');
    expect(twb).not.toContain('&apos;');
    expect(twb).toContain("name='O&#39;Brien Cup'");
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
