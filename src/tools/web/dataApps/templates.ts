/**
 * Live-query scaffold content for a new data-app workspace.
 *
 * A data app is a bundled Tableau **dashboard extension** that queries its published datasource(s)
 * LIVE via the Extensions API (`readMetadataAsync`/`queryAsync`) — there is NO embedded data
 * snapshot. This scaffold generates exactly four files: `index.html` (loads the Extensions API
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

/** One field, resolved from VizQL Data Service metadata, placed on the workbook's zombie sheet. */
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
  /** The single field placed on the zombie sheet so this datasource is "used" on the dashboard. */
  field: DataAppFieldBinding;
};

export type DataAppManifest = {
  schemaVersion: number;
  appName: string;
  packageId: string;
  entrypoint: string;
  template: string;
  /** Bindings the builder reads to synthesize the datasource references + zombie sheet. */
  datasources: DataAppDatasourceBinding[];
};

export type ScaffoldFile = { path: string; content: string };

export type ScaffoldInput = {
  appName: string;
  packageId: string;
  template?: string;
  datasources: DataAppDatasourceBinding[];
};

export function buildDataAppManifest(input: ScaffoldInput): DataAppManifest {
  return {
    schemaVersion: DATA_APP_MANIFEST_SCHEMA_VERSION,
    appName: input.appName,
    packageId: input.packageId,
    entrypoint: DATA_APP_ENTRYPOINT,
    template: input.template ?? LIVE_EXTENSION_TEMPLATE,
    datasources: input.datasources,
  };
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

// A live boot SKELETON. It initializes the extension, finds the datasource(s) on the dashboard, reads
// metadata, and renders a starter view that proves the live wiring works. The agent replaces the
// marked section with the real query (queryAsync) + visualization after introspecting the datasource
// with get-datasource-metadata / query-datasource. Everything stays local and uses safe DOM APIs
// (textContent / createElement) — never render live values as raw HTML.
const SCAFFOLD_APP_JS = `(function () {
  'use strict';

  var root = document.getElementById('app');

  // The new Extensions API wraps VDS output as { payload: '<json string>' }; older/other shapes
  // return { data: [...] } directly. Always unwrap through this helper.
  function extractData(result) {
    if (!result) return [];
    if (Array.isArray(result.data)) return result.data;
    var p = result.payload;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { return []; }
    }
    if (p && Array.isArray(p.data)) return p.data;
    return [];
  }

  // A dashboard extension can only see datasources used by a worksheet ON its own dashboard. The
  // builder wires a tiny "zombie" sheet for exactly this reason. Prefer the dashboard-wide list and
  // fall back to enumerating worksheets.
  function getDataSources(dashboard) {
    if (!dashboard) return Promise.resolve([]);
    if (typeof dashboard.getAllDataSourcesAsync === 'function') {
      return dashboard.getAllDataSourcesAsync();
    }
    var perSheet = (dashboard.worksheets || []).map(function (ws) {
      return ws.getDataSourcesAsync();
    });
    return Promise.all(perSheet).then(function (lists) {
      var byId = {};
      lists.forEach(function (list) {
        (list || []).forEach(function (ds) { byId[ds.id] = ds; });
      });
      return Object.keys(byId).map(function (id) { return byId[id]; });
    });
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
      var dc = tableau.extensions.dashboardContent;
      return getDataSources(dc && dc.dashboard);
    }).then(function (list) {
      ds = pickDataSource(list);
      if (!ds) { renderError('no data source found on the dashboard'); return; }

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
