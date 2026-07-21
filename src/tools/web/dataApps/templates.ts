/**
 * Static-only scaffold content for a new data-app workspace.
 *
 * Generates exactly five files (`index.html`, `src/app.js`, `src/styles.css`, `src/data.js`, and
 * the tool-managed `dataapp.json` manifest). `index.html` loads only local relative assets. There
 * is no live VizQL Data Service shim, proxy server, package manager, deploy file, or external CDN
 * reference — the app is a static snapshot that the agent authors further via
 * `upsert-data-app-files`.
 */

export const STATIC_HTML_TEMPLATE = 'static-html';
export const DATA_APP_MANIFEST_SCHEMA_VERSION = 1;
export const DATA_APP_MANIFEST_PATH = 'dataapp.json';
export const DATA_APP_ENTRYPOINT = 'index.html';

export type DataAppManifest = {
  schemaVersion: number;
  appName: string;
  packageId: string;
  entrypoint: string;
  template: string;
};

export type ScaffoldFile = { path: string; content: string };

export type ScaffoldInput = {
  appName: string;
  packageId: string;
  template?: string;
};

export function buildDataAppManifest(input: ScaffoldInput): DataAppManifest {
  return {
    schemaVersion: DATA_APP_MANIFEST_SCHEMA_VERSION,
    appName: input.appName,
    packageId: input.packageId,
    entrypoint: DATA_APP_ENTRYPOINT,
    template: input.template ?? STATIC_HTML_TEMPLATE,
  };
}

/** Build the exact, deterministic five-file static scaffold for a new workspace. */
export function buildScaffoldFiles(input: ScaffoldInput): ScaffoldFile[] {
  return [
    { path: DATA_APP_ENTRYPOINT, content: scaffoldIndexHtml(input.appName) },
    { path: 'src/app.js', content: SCAFFOLD_APP_JS },
    { path: 'src/styles.css', content: SCAFFOLD_STYLES_CSS },
    { path: 'src/data.js', content: SCAFFOLD_DATA_JS },
    {
      path: DATA_APP_MANIFEST_PATH,
      content: `${JSON.stringify(buildDataAppManifest(input), null, 2)}\n`,
    },
  ];
}

function scaffoldIndexHtml(appName: string): string {
  const title = escapeHtml(appName);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <link rel="stylesheet" href="src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="src/data.js"></script>
    <script src="src/app.js"></script>
  </body>
</html>
`;
}

const SCAFFOLD_APP_JS = `// Renders the static rows exported from src/data.js. Replace this with the real chart/table
// markup for this app; keep everything local -- no external scripts, no live queries.
(function () {
  var root = document.getElementById('app');
  var rows = (typeof DATA_APP_ROWS !== 'undefined' && DATA_APP_ROWS) || [];

  if (!root) {
    return;
  }

  if (rows.length === 0) {
    root.textContent = 'No data yet. Use upsert-data-app-files to add rows to src/data.js.';
    return;
  }

  var pre = document.createElement('pre');
  pre.textContent = JSON.stringify(rows, null, 2);
  root.appendChild(pre);
})();
`;

const SCAFFOLD_STYLES_CSS = `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: #1a1a1a;
  background: #ffffff;
}

#app {
  padding: 1.5rem;
}
`;

const SCAFFOLD_DATA_JS = `// Static data snapshot for this app. Replace DATA_APP_ROWS with the rows retrieved from Tableau --
// this file is loaded once at render time and is never re-queried against a live data source.
var DATA_APP_ROWS = [];
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
