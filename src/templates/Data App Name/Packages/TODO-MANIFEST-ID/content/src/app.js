(function () {
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
        //          // ...chart rows...
        //        });
        //   2. Default charting library: Vega-Lite (vega.github.io). Vendor vega/vega-lite/vega-embed
        //      locally (no CDN), build a spec from the rows, and render with vegaEmbed(el, spec).
        //      Vega-Lite draws to SVG/Canvas, so it renders inside the sandbox. If dataapp.json records
        //      a different chartingLibrary (a user override), use that library instead.
        //   3. For plain text/DOM use safe APIs (textContent / createElement): never raw HTML with
        //      live data.
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
