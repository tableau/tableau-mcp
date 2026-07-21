import {
  buildScaffoldFiles,
  DATA_APP_ENTRYPOINT,
  DATA_APP_MANIFEST_PATH,
  DATA_APP_MANIFEST_SCHEMA_VERSION,
  DataAppManifest,
  STATIC_HTML_TEMPLATE,
} from './templates.js';

describe('buildScaffoldFiles', () => {
  it('generates exactly the five specified files, no more and no fewer', () => {
    const files = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.myapp' });
    expect(files.map((f) => f.path).sort()).toEqual(
      ['dataapp.json', 'index.html', 'src/app.js', 'src/data.js', 'src/styles.css'].sort(),
    );
  });

  it('is deterministic for the same input', () => {
    const a = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.myapp' });
    const b = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.myapp' });
    expect(a).toEqual(b);
  });

  it('index.html loads only local relative assets, no external CDN or absolute URLs', () => {
    const files = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.myapp' });
    const indexHtml = files.find((f) => f.path === DATA_APP_ENTRYPOINT);
    expect(indexHtml).toBeDefined();
    expect(indexHtml!.content).toContain('src/app.js');
    expect(indexHtml!.content).toContain('src/styles.css');
    expect(indexHtml!.content).toContain('src/data.js');
    expect(indexHtml!.content).not.toMatch(/https?:\/\//);
    expect(indexHtml!.content).not.toContain('cdn.');
  });

  it('does not generate live-query shims, proxy servers, package managers, or deploy files', () => {
    const files = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.myapp' });
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('package.json');
    expect(paths).not.toContain('Procfile');
    expect(paths).not.toContain('server.js');
    const allContent = files.map((f) => f.content).join('\n');
    expect(allContent).not.toContain('window.tableauData');
    expect(allContent).not.toMatch(/https?:\/\//);
    expect(allContent.toLowerCase()).not.toContain('vizql');
  });

  it('dataapp.json is tool-managed JSON with schema version, appName, packageId, entrypoint, and template', () => {
    const files = buildScaffoldFiles({ appName: 'My App', packageId: 'com.example.myapp' });
    const manifestFile = files.find((f) => f.path === DATA_APP_MANIFEST_PATH);
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content) as DataAppManifest;
    expect(manifest).toEqual({
      schemaVersion: DATA_APP_MANIFEST_SCHEMA_VERSION,
      appName: 'My App',
      packageId: 'com.example.myapp',
      entrypoint: DATA_APP_ENTRYPOINT,
      template: STATIC_HTML_TEMPLATE,
    });
  });

  it('preserves an explicitly requested template instead of defaulting it', () => {
    const files = buildScaffoldFiles({
      appName: 'My App',
      packageId: 'com.example.myapp',
      template: 'static-html',
    });
    const manifest = JSON.parse(
      files.find((f) => f.path === DATA_APP_MANIFEST_PATH)!.content,
    ) as DataAppManifest;
    expect(manifest.template).toBe('static-html');
  });

  it('escapes the app name when embedding it in index.html', () => {
    const files = buildScaffoldFiles({
      appName: '<script>alert(1)</script>',
      packageId: 'com.example.myapp',
    });
    const indexHtml = files.find((f) => f.path === DATA_APP_ENTRYPOINT)!.content;
    expect(indexHtml).not.toContain('<script>alert(1)</script>');
    expect(indexHtml).toContain('&lt;script&gt;');
  });
});
