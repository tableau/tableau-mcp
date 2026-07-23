import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { DataAppSnapshot } from '../../../dataApps/types.js';
import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import { EXTENSIONS_LIB_PATH } from './buildTwbx.js';
import {
  buildWorkspaceTwbx,
  listPackagedWorkspaceFiles,
  readDatasourceBindings,
  WORKSPACE_ENTRYPOINT,
  WORKSPACE_MANIFEST,
} from './buildWorkspaceTwbx.js';

// Build a snapshot from a plain {path: text} map. Files are sorted like the real store's snapshot so
// tests exercise the same deterministic ordering the builder relies on.
function snapshot(files: Record<string, string | Uint8Array>): DataAppSnapshot {
  const entries = Object.entries(files)
    .map(([path, content]) => ({
      path,
      content: typeof content === 'string' ? new TextEncoder().encode(content) : content,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { appId: 'a'.repeat(32), files: entries, digest: 'source-digest', createdAt: new Date() };
}

function entries(bytes: Uint8Array): Record<string, string> {
  const raw = unzipSync(bytes);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strFromU8(v)]));
}

const options = { workbookName: 'My App', packageId: 'com.example.myapp' };

const MANIFEST = {
  schemaVersion: 2,
  appName: 'My App',
  packageId: 'com.example.myapp',
  entrypoint: 'index.html',
  template: 'live-extension',
  datasources: [
    {
      luid: '00c07e8d-62a8-4bb0-96fd-a3227b610253',
      contentUrl: 'WorldCupSongs',
      name: 'World Cup Songs',
      sqlproxyName: 'sqlproxy.abc123',
      host: 'tableau.example.com',
      port: '8080',
      field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
    },
  ],
};

const SCAFFOLD = {
  'index.html':
    '<!doctype html><html><head><link rel="stylesheet" href="src/styles.css"></head>' +
    '<body><div id="app"></div><script src="src/tableau.extensions.1.latest.js"></script>' +
    '<script src="src/app.js"></script></body></html>',
  'src/app.js': 'console.log("app");',
  'src/styles.css': 'body{margin:0}',
  'dataapp.json': JSON.stringify(MANIFEST),
};

describe('buildWorkspaceTwbx', () => {
  it('packages the entrypoint, scaffold assets, and the injected lib under content/', () => {
    const { bytes } = buildWorkspaceTwbx(snapshot(SCAFFOLD), options);
    const paths = Object.keys(entries(bytes)).sort();
    expect(paths).toEqual(
      [
        'My App.twb',
        'Packages/com.example.myapp/manifest.json',
        'Packages/com.example.myapp/extensions/toolbar.trex',
        'Packages/com.example.myapp/content/index.html',
        'Packages/com.example.myapp/content/src/app.js',
        'Packages/com.example.myapp/content/src/styles.css',
        `Packages/com.example.myapp/content/${EXTENSIONS_LIB_PATH}`,
      ].sort(),
    );
  });

  it('wires the manifest datasource bindings into the .twb (sqlproxy + zombie sheet)', () => {
    const twb = entries(buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes)['My App.twb'];
    expect(twb).toContain("name='sqlproxy.abc123'");
    expect(twb).toContain("dbname='WorldCupSongs'");
    expect(twb).toContain('<rows>[sqlproxy.abc123].[none:song_title:nk]</rows>');
    expect(twb).toContain("id='5' name='Sheet 1'");
  });

  it('does NOT ship the tool-managed dataapp.json manifest as package content', () => {
    const files = entries(buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes);
    const shipped = Object.keys(files);
    expect(shipped.some((p) => p.includes('dataapp.json'))).toBe(false);
  });

  it('preserves the entrypoint bytes verbatim as content/index.html', () => {
    const entrypoint = new Uint8Array([
      0xef, 0xbb, 0xbf, 0x00, 0x80, 0xff, 0x3c, 0x68, 0x74, 0x6d, 0x6c,
    ]);
    const archive = unzipSync(
      buildWorkspaceTwbx(snapshot({ ...SCAFFOLD, 'index.html': entrypoint }), options).bytes,
    );

    expect(archive['Packages/com.example.myapp/content/index.html']).toEqual(entrypoint);
  });

  it('is deterministic: an identical snapshot yields byte-identical output', () => {
    const a = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const b = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('throws a BuildTwbxError (hard structural failure) when the snapshot has no index.html', () => {
    const noEntry = snapshot({ 'src/app.js': 'x', 'dataapp.json': '{}' });
    expect(() => buildWorkspaceTwbx(noEntry, options)).toThrow(BuildTwbxError);
  });

  it('surfaces a non-blocking extension warning for a packaged file off the serve-time allow-list', () => {
    const { warnings } = buildWorkspaceTwbx(
      snapshot({ ...SCAFFOLD, 'data.parquet': 'x' }),
      options,
    );
    expect(warnings.some((w) => w.includes('data.parquet'))).toBe(true);
  });

  it('rejects an illegal packageId via the underlying builder', () => {
    expect(() =>
      buildWorkspaceTwbx(snapshot(SCAFFOLD), { ...options, packageId: '1bad id!' }),
    ).toThrow(BuildTwbxError);
  });

  describe('readDatasourceBindings', () => {
    it('maps manifest datasources into builder bindings', () => {
      const bindings = readDatasourceBindings(snapshot(SCAFFOLD));
      expect(bindings).toEqual([
        {
          sqlproxyName: 'sqlproxy.abc123',
          contentUrl: 'WorldCupSongs',
          caption: 'World Cup Songs',
          host: 'tableau.example.com',
          port: '8080',
          field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
        },
      ]);
    });

    it('returns an empty list when the manifest is missing or has no datasources', () => {
      expect(readDatasourceBindings(snapshot({ 'index.html': '<html></html>' }))).toEqual([]);
      expect(
        readDatasourceBindings(snapshot({ 'index.html': '<html></html>', 'dataapp.json': '{}' })),
      ).toEqual([]);
    });
  });

  describe('listPackagedWorkspaceFiles', () => {
    it('includes the entrypoint and all non-manifest files, excluding dataapp.json', () => {
      const packaged = listPackagedWorkspaceFiles(snapshot(SCAFFOLD));
      const paths = packaged.map((f) => f.path).sort();
      expect(paths).toEqual(['index.html', 'src/app.js', 'src/styles.css']);
      expect(paths).toContain(WORKSPACE_ENTRYPOINT);
      expect(paths).not.toContain(WORKSPACE_MANIFEST);
    });

    it('normalizes a leading ./ path form', () => {
      const packaged = listPackagedWorkspaceFiles(
        snapshot({ 'index.html': '<html></html>', './src/app.js': 'x' }),
      );
      expect(packaged.map((f) => f.path).sort()).toEqual(['index.html', 'src/app.js']);
    });
  });
});
