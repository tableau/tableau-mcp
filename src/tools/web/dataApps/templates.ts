/**
 * Live-query scaffold content for a new data-app workspace.
 *
 * A data app is a bundled Tableau **viz (worksheet) extension** that queries its published
 * datasource(s) LIVE via the Extensions API (`readMetadataAsync`/`queryAsync`) — there is NO embedded
 * data snapshot. This scaffold generates exactly four files: `index.html` (loads the Extensions API
 * library then `src/app.js`), `src/app.js` (a live boot skeleton the agent fills in after
 * introspecting the datasource), `src/styles.css`, and the tool-managed `dataapp.json` manifest
 * (which records the datasource bindings used to wire the workbook at build time).
 *
 * The Extensions API library itself is NOT scaffolded here — `buildTwbx` injects it into the package
 * at `content/src/tableau.extensions.1.latest.js` (it is identical for every app, so keeping it out
 * of the per-app workspace keeps the scoped store small). `index.html` references that path directly.
 */

import type { DataAppFieldDataType } from '../createAndPublishWorkbook/buildTwbx.js';

export const LIVE_EXTENSION_TEMPLATE = 'live-extension';
export const DATA_APP_MANIFEST_SCHEMA_VERSION = 2;
export const DATA_APP_MANIFEST_PATH = 'dataapp.json';
export const DATA_APP_ENTRYPOINT = 'index.html';
/** The content-relative path index.html references for the injected Extensions API library. */
export const EXTENSIONS_LIB_REF = 'src/tableau.extensions.1.latest.js';

/** One field, resolved from VizQL Data Service metadata, placed on the workbook's host sheet. */
export type DataAppFieldBinding = {
  /** Logical field name without brackets (VDS `fieldName`), e.g. `song_title`. */
  fieldName: string;
  /** Display caption (VDS `fieldCaption`), e.g. `Song Title`. */
  caption: string;
  /** VDS data type; drives the workbook column metadata. */
  dataType: DataAppFieldDataType;
};

/** A published datasource the live app queries, with everything needed to wire the workbook. */
export type DataAppDatasourceBinding = {
  /** The published datasource LUID (the id the app passes to queryAsync/readMetadataAsync). */
  luid: string;
  /** The datasource contentUrl (repository-location id + sqlproxy dbname). */
  contentUrl: string;
  /** The datasource display name / caption. */
  name: string;
  /** The workbook-local sqlproxy connection name (`sqlproxy.<hash>`), stable per contentUrl. */
  sqlproxyName: string;
  /** Tableau server host derived from the configured SERVER origin. */
  host: string;
  /** Tableau server port derived from the configured SERVER origin. */
  port: string;
  /** The single field placed on the host sheet so this datasource is "used" (survives publish). */
  field: DataAppFieldBinding;
};

export type DataAppManifest = {
  schemaVersion: number;
  appName: string;
  packageId: string;
  entrypoint: string;
  template: string;
  /** Bindings the builder reads to synthesize the datasource references + host sheet. */
  datasources: DataAppDatasourceBinding[];
  /** Optional space-separated CSP origin sources the app may fetch/connect to at runtime. Persisted
   *  here so it survives to publish; the builder copies it into the package manifest's `allowedOrigins`
   *  (see buildTwbx). Absent/blank ⇒ omitted (dataapp.json stays byte-identical to a no-origins app). */
  allowedOrigins?: string;
};

export type ScaffoldFile = { path: string; content: string };

export type ScaffoldInput = {
  appName: string;
  packageId: string;
  template?: string;
  datasources: DataAppDatasourceBinding[];
  /** Optional space-separated CSP origin sources (see {@link DataAppManifest.allowedOrigins}). */
  allowedOrigins?: string;
};

export function buildDataAppManifest(input: ScaffoldInput): DataAppManifest {
  const manifest: DataAppManifest = {
    schemaVersion: DATA_APP_MANIFEST_SCHEMA_VERSION,
    appName: input.appName,
    packageId: input.packageId,
    entrypoint: DATA_APP_ENTRYPOINT,
    template: input.template ?? LIVE_EXTENSION_TEMPLATE,
    datasources: input.datasources,
  };
  // Emit the key only when set (trimmed, non-empty), always as the last field for deterministic
  // ordering, so a no-origins app's dataapp.json is byte-identical to before this field existed.
  const origins = input.allowedOrigins?.trim();
  if (origins) {
    manifest.allowedOrigins = origins;
  }
  return manifest;
}

/** Build the exact, deterministic four-file live scaffold for a new workspace (no data.js). */
export function buildScaffoldFiles(input: ScaffoldInput): ScaffoldFile[] {
  return [
    { path: DATA_APP_ENTRYPOINT, content: scaffoldIndexHtml(input.appName) },
    { path: 'src/app.js', content: SCAFFOLD_APP_JS },
    { path: 'src/styles.css', content: SCAFFOLD_STYLES_CSS },
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
    <!-- Tableau Extensions API library. Injected into the package by the builder at this exact path;
         it is not part of the workspace source. Must load before app.js. -->
    <script src="${EXTENSIONS_LIB_REF}"></script>
    <script src="src/app.js"></script>
  </body>
</html>
`;
}

// A live boot SKELETON for a VIZ (worksheet) extension. It initializes the extension, finds the
// datasource(s) wired into the workbook, reads metadata, and renders a starter view that proves the
// live wiring works. The agent replaces the marked section with the real query (queryAsync) +
// visualization after introspecting the datasource with get-datasource-metadata / query-datasource.
// Everything stays local and uses safe DOM APIs (textContent / createElement) — never render live
// values as raw HTML.
const SCAFFOLD_APP_JS = `(function () {
  'use strict';

  var root = document.getElementById('app');

  // queryAsync/readMetadataAsync return the standard VizQL Data Service shape: { data: [...] }.
  function extractData(result) {
    return result && Array.isArray(result.data) ? result.data : [];
  }

  // This is a viz extension: it is hosted on a worksheet (tableau.extensions.worksheetContent) rather
  // than a dashboard. The workbook-level list reaches EVERY datasource wired into the workbook (not
  // just the host worksheet's), which is what we query live; fall back to the host worksheet's own
  // datasources if the workbook list is unavailable.
  function getDataSources() {
    var wb = tableau.extensions.workbook;
    if (wb && typeof wb.getAllDataSourcesAsync === 'function') {
      return wb.getAllDataSourcesAsync();
    }
    var wc = tableau.extensions.worksheetContent;
    if (wc && wc.worksheet && typeof wc.worksheet.getDataSourcesAsync === 'function') {
      return wc.worksheet.getDataSourcesAsync();
    }
    return Promise.resolve([]);
  }

  function pickDataSource(list) {
    return (list && list.length) ? list[0] : null;
  }

  function renderError(msg) {
    root.textContent = '';
    var p = document.createElement('p');
    p.className = 'error';
    p.textContent = 'Live query unavailable: ' + msg;
    root.appendChild(p);
  }

  // Starter render: proves the live datasource + metadata are reachable. REPLACE THIS with the real
  // visualization once you have authored a queryAsync(...) call for this app.
  function renderStarter(ds, fields) {
    root.textContent = '';
    var h = document.createElement('h1');
    h.textContent = ds.name;
    root.appendChild(h);
    var note = document.createElement('p');
    note.textContent = 'Live datasource connected. ' + fields.length +
      ' fields available. Author your query + visualization in src/app.js.';
    root.appendChild(note);
    var ul = document.createElement('ul');
    fields.forEach(function (f) {
      var li = document.createElement('li');
      li.textContent = (f.fieldCaption || f.fieldName) + ' (' + f.dataType + ')';
      ul.appendChild(li);
    });
    root.appendChild(ul);
  }

  function boot() {
    if (!window.tableau || !tableau.extensions) {
      renderError('Extensions API not loaded');
      return;
    }
    var ds;
    tableau.extensions.initializeAsync().then(function () {
      return getDataSources();
    }).then(function (list) {
      ds = pickDataSource(list);
      if (!ds) { renderError('no data source found in the workbook'); return; }

      // read-metadata -> the fields VDS knows about for this datasource.
      var metaP = (typeof ds.readMetadataAsync === 'function')
        ? ds.readMetadataAsync().then(function (m) { return extractData(m); })
        : Promise.resolve([]);

      return metaP.then(function (fields) {
        // ---------------------------------------------------------------------------------------
        // AUTHOR YOUR APP HERE.
        //   1. Build a VDS query (fields + optional filters), e.g.:
        //        var query = { fields: [ { fieldCaption: 'Category' },
        //                                 { fieldCaption: 'Sales', function: 'SUM' } ] };
        //        return ds.queryAsync(query).then(function (result) {
        //          var rows = extractData(result);
        //          // ...render rows...
        //        });
        //   2. Render with safe DOM APIs (textContent / createElement) — never raw HTML + live data.
        // Until then, the starter view below confirms the live wiring works.
        // ---------------------------------------------------------------------------------------
        renderStarter(ds, fields);
      });
    }).catch(function (err) {
      renderError((err && (err.message || err.errorCode)) || String(err));
    });
  }

  boot();
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

.error {
  color: #b00020;
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
