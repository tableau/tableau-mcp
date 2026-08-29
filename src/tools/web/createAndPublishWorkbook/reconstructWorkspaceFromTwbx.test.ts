import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { DataAppSnapshot } from '../../../dataApps/types.js';
import { WorkbookDataAppNotFoundError } from '../../../errors/mcpToolError.js';
import { EXTENSIONS_LIB_PATH } from './buildTwbx.js';
import { buildWorkspaceTwbx } from './buildWorkspaceTwbx.js';
import {
  parseDatasourceBindings,
  reconstructWorkspaceFromTwbx,
} from './reconstructWorkspaceFromTwbx.js';

// The same scaffold shape buildWorkspaceTwbx.test.ts uses, so the two suites round-trip the identical
// package. `luid` is present here; the reconstruction drops it to '' (the workbook never records it).
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

const SCAFFOLD: Record<string, string> = {
  'index.html':
    '<!doctype html><html><head><link rel="stylesheet" href="src/styles.css"></head>' +
    '<body><div id="app"></div><script src="src/tableau.extensions.1.latest.js"></script>' +
    '<script src="src/app.js"></script></body></html>',
  'src/app.js': 'console.log("app");',
  'src/styles.css': 'body{margin:0}',
  'dataapp.json': JSON.stringify(MANIFEST),
};

const options = { workbookName: 'My App', packageId: 'com.example.myapp' };

// Build a snapshot from a {path: text|bytes} map, sorted like the real store's snapshot.
function snapshot(files: Record<string, string | Uint8Array>): DataAppSnapshot {
  const entries = Object.entries(files)
    .map(([path, content]) => ({
      path,
      content: typeof content === 'string' ? new TextEncoder().encode(content) : content,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { appId: 'a'.repeat(32), files: entries, digest: 'source-digest', createdAt: new Date() };
}

// Decode a reconstructed file's content (string kept as-is, bytes -> UTF-8) for text comparison.
function text(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

// The .twb produced by a real scaffold build — the input parseDatasourceBindings inverts.
function builtTwb(): string {
  const raw = unzipSync(buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes);
  return new TextDecoder().decode(raw['My App.twb']);
}

// A minimal archive from a {path: text|bytes} map (for the structural failure cases).
function archive(files: Record<string, string | Uint8Array>): Uint8Array {
  const zip: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zip[path] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(zip);
}

describe('reconstructWorkspaceFromTwbx', () => {
  it('round-trips a scaffold build back into the same workspace source', () => {
    const bytes = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);

    expect(workspace.appName).toBe('My App');
    expect(workspace.packageId).toBe('com.example.myapp');

    const byPath = Object.fromEntries(workspace.files.map((f) => [f.path, text(f.content)]));
    // The injected Extensions API library is NOT stored in the workspace (the builder re-injects it),
    // and dataapp.json is rebuilt (below) rather than carried through from package content.
    expect(Object.keys(byPath).sort()).toEqual([
      'dataapp.json',
      'index.html',
      'src/app.js',
      'src/styles.css',
    ]);
    expect(byPath['src/app.js']).toBe(SCAFFOLD['src/app.js']);
    expect(byPath['src/styles.css']).toBe(SCAFFOLD['src/styles.css']);
    expect(byPath['index.html']).toBe(SCAFFOLD['index.html']);
  });

  it('does NOT store the injected Extensions API library in the recovered workspace', () => {
    const bytes = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);
    expect(workspace.files.some((f) => f.path === EXTENSIONS_LIB_PATH)).toBe(false);
  });

  it('recovers the datasource bindings (luid dropped to empty)', () => {
    const bytes = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);
    expect(workspace.datasources).toEqual([
      {
        luid: '',
        contentUrl: 'WorldCupSongs',
        name: 'World Cup Songs',
        sqlproxyName: 'sqlproxy.abc123',
        host: 'tableau.example.com',
        port: '8080',
        field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
      },
    ]);
  });

  it('rebuilds dataapp.json in the exact scaffold shape (schemaVersion 2 + recovered bindings)', () => {
    const bytes = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);
    const manifestFile = workspace.files.find((f) => f.path === 'dataapp.json');
    expect(manifestFile).toBeDefined();
    // Trailing newline mirrors buildScaffoldFiles / scaffold-data-app.
    expect(text(manifestFile!.content).endsWith('\n')).toBe(true);
    const manifest = JSON.parse(text(manifestFile!.content));
    expect(manifest).toEqual({
      schemaVersion: 2,
      appName: 'My App',
      packageId: 'com.example.myapp',
      entrypoint: 'index.html',
      template: 'live-extension',
      datasources: [
        {
          luid: '',
          contentUrl: 'WorldCupSongs',
          name: 'World Cup Songs',
          sqlproxyName: 'sqlproxy.abc123',
          host: 'tableau.example.com',
          port: '8080',
          field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
        },
      ],
    });
  });

  it('is a faithful inverse: reopening then rebuilding yields a byte-identical package', () => {
    // The rebuilt package must be byte-identical because (a) the content files round-trip verbatim,
    // (b) the injected lib is deterministic, and (c) dataapp.json is not shipped and the builder never
    // reads the dropped luid — so the recovered bindings drive the same .twb.
    const original = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(original);
    const rebuilt = buildWorkspaceTwbx(snapshot(objectFromFiles(workspace.files)), {
      workbookName: workspace.appName,
      packageId: workspace.packageId,
    }).bytes;
    expect(Buffer.from(rebuilt).equals(Buffer.from(original))).toBe(true);
  });

  it('recovers allowedOrigins from the package manifest and rebuilds it into dataapp.json', () => {
    const withOrigins = {
      ...SCAFFOLD,
      'dataapp.json': JSON.stringify({
        ...MANIFEST,
        allowedOrigins: 'https://api.example.com https://cdn.example.com',
      }),
    };
    const bytes = buildWorkspaceTwbx(snapshot(withOrigins), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);

    expect(workspace.allowedOrigins).toBe('https://api.example.com https://cdn.example.com');
    const manifest = JSON.parse(
      text(workspace.files.find((f) => f.path === 'dataapp.json')!.content),
    );
    expect(manifest.allowedOrigins).toBe('https://api.example.com https://cdn.example.com');
  });

  it('leaves allowedOrigins undefined when the package declared none', () => {
    const bytes = buildWorkspaceTwbx(snapshot(SCAFFOLD), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);
    expect(workspace.allowedOrigins).toBeUndefined();
    const manifest = JSON.parse(
      text(workspace.files.find((f) => f.path === 'dataapp.json')!.content),
    );
    expect(manifest).not.toHaveProperty('allowedOrigins');
  });

  it('round-trips allowedOrigins byte-identically through reopen + rebuild', () => {
    const withOrigins = {
      ...SCAFFOLD,
      'dataapp.json': JSON.stringify({ ...MANIFEST, allowedOrigins: 'https://api.example.com' }),
    };
    const original = buildWorkspaceTwbx(snapshot(withOrigins), options).bytes;
    const workspace = reconstructWorkspaceFromTwbx(original);
    const rebuilt = buildWorkspaceTwbx(snapshot(objectFromFiles(workspace.files)), {
      workbookName: workspace.appName,
      packageId: workspace.packageId,
    }).bytes;
    expect(Buffer.from(rebuilt).equals(Buffer.from(original))).toBe(true);
  });

  it('preserves a binary asset verbatim through the round trip', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const bytes = buildWorkspaceTwbx(
      snapshot({ ...SCAFFOLD, 'assets/logo.png': png }),
      options,
    ).bytes;
    const workspace = reconstructWorkspaceFromTwbx(bytes);
    const logo = workspace.files.find((f) => f.path === 'assets/logo.png');
    expect(logo).toBeDefined();
    expect(logo!.content).toEqual(png);
  });

  it('prefers the folder id / .twb base name when the package manifest is malformed', () => {
    const twb = builtTwb();
    const bytes = archive({
      'Recovered Name.twb': twb,
      'Packages/com.folder.id/manifest.json': 'not json{',
      'Packages/com.folder.id/content/index.html': '<html></html>',
    });
    const workspace = reconstructWorkspaceFromTwbx(bytes);
    expect(workspace.packageId).toBe('com.folder.id');
    expect(workspace.appName).toBe('Recovered Name');
  });

  describe('rejects inputs that are not a data-app package', () => {
    it('throws when the bytes are not a valid archive', () => {
      expect(() => reconstructWorkspaceFromTwbx(new Uint8Array([1, 2, 3, 4]))).toThrow(
        WorkbookDataAppNotFoundError,
      );
    });

    it('throws when there is no Packages/<id>/manifest.json', () => {
      const bytes = archive({
        'My App.twb': builtTwb(),
        'Packages/com.x/content/index.html': '<html></html>',
      });
      expect(() => reconstructWorkspaceFromTwbx(bytes)).toThrow(WorkbookDataAppNotFoundError);
    });

    it('throws when the package has no content/index.html entrypoint', () => {
      const bytes = archive({
        'My App.twb': builtTwb(),
        'Packages/com.x/manifest.json': JSON.stringify({ id: 'com.x', name: 'My App' }),
        'Packages/com.x/content/src/app.js': 'x',
      });
      expect(() => reconstructWorkspaceFromTwbx(bytes)).toThrow(WorkbookDataAppNotFoundError);
    });

    it('throws when there is no root .twb workbook', () => {
      const bytes = archive({
        'Packages/com.x/manifest.json': JSON.stringify({ id: 'com.x', name: 'My App' }),
        'Packages/com.x/content/index.html': '<html></html>',
      });
      expect(() => reconstructWorkspaceFromTwbx(bytes)).toThrow(WorkbookDataAppNotFoundError);
    });

    it('throws when the workbook XML declares a DOCTYPE (XXE defense)', () => {
      const bytes = archive({
        'My App.twb': '<!DOCTYPE workbook><workbook version="18.1"><datasources /></workbook>',
        'Packages/com.x/manifest.json': JSON.stringify({ id: 'com.x', name: 'My App' }),
        'Packages/com.x/content/index.html': '<html></html>',
      });
      expect(() => reconstructWorkspaceFromTwbx(bytes)).toThrow(WorkbookDataAppNotFoundError);
    });
  });
});

describe('parseDatasourceBindings', () => {
  it('recovers a published-datasource binding from real built .twb XML', () => {
    expect(parseDatasourceBindings(builtTwb())).toEqual([
      {
        luid: '',
        contentUrl: 'WorldCupSongs',
        name: 'World Cup Songs',
        sqlproxyName: 'sqlproxy.abc123',
        host: 'tableau.example.com',
        port: '8080',
        field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
      },
    ]);
  });

  it('returns an empty list for an extension-only workbook (no repository-location datasource)', () => {
    const bytes = buildWorkspaceTwbx(
      snapshot({
        'index.html': '<html></html>',
        'src/app.js': 'x',
      }),
      options,
    ).bytes;
    const twb = new TextDecoder().decode(unzipSync(bytes)['My App.twb']);
    expect(parseDatasourceBindings(twb)).toEqual([]);
  });

  it('throws WorkbookDataAppNotFoundError on a DOCTYPE declaration', () => {
    expect(() => parseDatasourceBindings('<!DOCTYPE workbook><workbook />')).toThrow(
      WorkbookDataAppNotFoundError,
    );
  });

  it('throws WorkbookDataAppNotFoundError on malformed XML', () => {
    expect(() => parseDatasourceBindings('<workbook><datasources></workbook>')).toThrow(
      WorkbookDataAppNotFoundError,
    );
  });
});

// Turn recovered workspace files back into a {path: bytes} map for a rebuild snapshot.
function objectFromFiles(
  files: Array<{ path: string; content: string | Uint8Array }>,
): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  for (const f of files) {
    out[f.path] = f.content;
  }
  return out;
}
