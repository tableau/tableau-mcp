import { describe, expect, it } from 'vitest';

import {
  buildScaffoldFiles,
  DATA_APP_ENTRYPOINT,
  DATA_APP_MANIFEST_PATH,
  DATA_APP_MANIFEST_SCHEMA_VERSION,
  DataAppDatasourceBinding,
  DataAppManifest,
  EXTENSIONS_LIB_REF,
  LIVE_EXTENSION_TEMPLATE,
} from './templates.js';

const binding: DataAppDatasourceBinding = {
  luid: '00c07e8d-62a8-4bb0-96fd-a3227b610253',
  contentUrl: 'WorldCupSongs',
  name: 'World Cup Songs',
  sqlproxyName: 'sqlproxy.abc123',
  host: 'tableau.example.com',
  port: '8080',
  field: { fieldName: 'song_title', caption: 'Song Title', dataType: 'STRING' },
};

const input = {
  appName: 'My App',
  packageId: 'com.example.myapp',
  datasources: [binding],
};

describe('buildScaffoldFiles', () => {
  it('generates exactly the four live-scaffold files (no data.js)', () => {
    const files = buildScaffoldFiles(input);
    expect(files.map((f) => f.path).sort()).toEqual(
      ['dataapp.json', 'index.html', 'src/app.js', 'src/styles.css'].sort(),
    );
    expect(files.map((f) => f.path)).not.toContain('src/data.js');
  });

  it('is deterministic for the same input', () => {
    expect(buildScaffoldFiles(input)).toEqual(buildScaffoldFiles(input));
  });

  it('index.html loads the Extensions API library then app.js, and no external URLs', () => {
    const indexHtml = buildScaffoldFiles(input).find(
      (f) => f.path === DATA_APP_ENTRYPOINT,
    )!.content;
    expect(indexHtml).toContain(EXTENSIONS_LIB_REF);
    expect(indexHtml).toContain('src/app.js');
    expect(indexHtml).toContain('src/styles.css');
    expect(indexHtml).not.toContain('src/data.js');
    expect(indexHtml).not.toMatch(/https?:\/\//);
    expect(indexHtml).not.toContain('cdn.');
  });

  it('app.js is a live boot skeleton with the payload-unwrap helper and query hooks', () => {
    const appJs = buildScaffoldFiles(input).find((f) => f.path === 'src/app.js')!.content;
    expect(appJs).toContain('initializeAsync');
    expect(appJs).toContain('function extractData');
    expect(appJs).toContain('result.payload');
    expect(appJs).toContain('getAllDataSourcesAsync');
    expect(appJs).toContain('queryAsync');
    // Safe DOM only — never innerHTML with live values.
    expect(appJs).toContain('textContent');
    expect(appJs).not.toContain('innerHTML');
    // Explicit no-data / error state, not a static fallback.
    expect(appJs).toContain('Live query unavailable');
  });

  it('dataapp.json records the datasource bindings alongside the manifest metadata', () => {
    const manifestFile = buildScaffoldFiles(input).find((f) => f.path === DATA_APP_MANIFEST_PATH)!;
    const manifest = JSON.parse(manifestFile.content) as DataAppManifest;
    expect(manifest).toEqual({
      schemaVersion: DATA_APP_MANIFEST_SCHEMA_VERSION,
      appName: 'My App',
      packageId: 'com.example.myapp',
      entrypoint: DATA_APP_ENTRYPOINT,
      template: LIVE_EXTENSION_TEMPLATE,
      datasources: [binding],
    });
  });

  it('preserves an explicitly requested template instead of defaulting it', () => {
    const files = buildScaffoldFiles({ ...input, template: LIVE_EXTENSION_TEMPLATE });
    const manifest = JSON.parse(
      files.find((f) => f.path === DATA_APP_MANIFEST_PATH)!.content,
    ) as DataAppManifest;
    expect(manifest.template).toBe(LIVE_EXTENSION_TEMPLATE);
  });

  it('escapes the app name when embedding it in index.html', () => {
    const files = buildScaffoldFiles({ ...input, appName: '<script>alert(1)</script>' });
    const indexHtml = files.find((f) => f.path === DATA_APP_ENTRYPOINT)!.content;
    expect(indexHtml).not.toContain('<script>alert(1)</script>');
    expect(indexHtml).toContain('&lt;script&gt;');
  });
});
