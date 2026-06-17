import type { DataAppResource } from './dataAppShared.js';
import { getScaffoldFiles } from './templates.js';

describe('getScaffoldFiles', () => {
  const resources: DataAppResource[] = [
    { type: 'datasource', luid: 'ds-luid-123', name: 'primary' },
    { type: 'view', luid: 'view-luid-456', name: 'trend' },
    { type: 'metric', luid: 'metric-luid-789', name: 'hbiReqs' },
  ];
  const baseArgs = {
    appName: 'Sales Overview',
    appTitle: 'Sales Overview',
    resources,
  };

  it('emits the expected project files for the html framework', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    expect(Object.keys(files).sort()).toEqual(
      [
        '.gitignore',
        'AGENTS.md',
        'README.md',
        'Procfile',
        'dataapp.json',
        'index.html',
        'manifest.trex',
        'package.json',
        'server.js',
        'src/app.js',
        'src/config.js',
        'src/styles.css',
        'src/tableauData.js',
      ].sort(),
    );
  });

  it('bakes the full resource list into config.js and dataapp.json', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    expect(files['src/config.js']).toContain('window.TABLEAU_APP_CONFIG');
    expect(files['src/config.js']).toContain('ds-luid-123');
    expect(files['src/config.js']).toContain('view-luid-456');
    expect(files['src/config.js']).toContain('metric-luid-789');
    // First datasource exposed for shim convenience.
    expect(files['src/config.js']).toContain('"datasourceLuid": "ds-luid-123"');

    const manifest = JSON.parse(files['dataapp.json']);
    expect(manifest.resources).toEqual(resources);
  });

  it('wires the app title into index.html and the Extensions API script', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    expect(files['index.html']).toContain('<title>Sales Overview</title>');
    expect(files['index.html']).toContain('tableau.extensions.1.latest.min.js');
    expect(files['index.html']).toContain('<script src="src/app.js"></script>');
  });

  it('uses a module script tag for the react framework', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'react' });
    expect(files['index.html']).toContain('<script type="module" src="src/app.js"></script>');
    expect(files['src/app.js']).toContain("from 'https://esm.sh/preact");
  });

  it('the shim posts to the configured query endpoint and never hardcodes data', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    expect(files['src/tableauData.js']).toContain('window.tableauData');
    expect(files['src/tableauData.js']).toContain('postJson(queryEndpoint');
  });

  it('emits a Heroku-ready proxy server with endpoints for every resource type', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    expect(files['server.js']).toContain("app.post('/query'");
    expect(files['server.js']).toContain('vizql-data-service/query-datasource');
    expect(files['server.js']).toContain("app.post('/view-data'");
    expect(files['server.js']).toContain("app.post('/workbook-views'");
    expect(files['server.js']).toContain("app.post('/pulse-metrics'");
    expect(files['server.js']).toContain('pulse/metrics:batchGet');
    expect(files['package.json']).toContain('"start": "node server.js"');
    expect(files['Procfile']).toContain('node server.js');
  });

  it('the shim exposes a typed method per resource type', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    const shim = files['src/tableauData.js'];
    expect(shim).toContain('getViewData');
    expect(shim).toContain('getWorkbookViews');
    expect(shim).toContain('getMetrics');
    expect(shim).toContain('getMetricValues');
    expect(shim).toContain('resourcesByName');
  });

  it('caches the Tableau session instead of signing in per request', () => {
    const server = getScaffoldFiles({ ...baseArgs, framework: 'html' })['server.js'];
    expect(server).toContain('cachedSession');
    expect(server).toContain('signInFlight');
    expect(server).toContain('invalidateSession');
    expect(server).toContain('tableauRequest');
    // No per-request sign-out (which would race-invalidate parallel requests).
    expect(server).not.toContain('signOut');
  });

  it('exposes a Pulse value endpoint and adds actionable VDS error hints', () => {
    const server = getScaffoldFiles({ ...baseArgs, framework: 'html' })['server.js'];
    expect(server).toContain("app.post('/pulse-metric-values'");
    expect(server).toContain('pulse/insights/ban');
    expect(server).toContain('function vdsHint');
    expect(server).toContain('out.actionable = hint');
  });

  it('emits a placeholder .trex that does not yet point at a real host', () => {
    const files = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    expect(files['manifest.trex']).toContain('<dashboard-extension');
    expect(files['manifest.trex']).toContain('REPLACE_AT_DEPLOY_TIME');
  });

  it('generated app stubs contain no inline dataset', () => {
    const html = getScaffoldFiles({ ...baseArgs, framework: 'html' });
    const react = getScaffoldFiles({ ...baseArgs, framework: 'react' });
    // crude proxy for "no hardcoded array of records"
    expect(html['src/app.js']).not.toMatch(/\}\s*,\s*\{[\s\S]*\}\s*,\s*\{/);
    expect(react['src/app.js']).not.toMatch(/\}\s*,\s*\{[\s\S]*\}\s*,\s*\{/);
  });
});
