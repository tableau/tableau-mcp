(function () {
  'use strict';

  var root = document.getElementById('app');

  // Desktop scaffolding replaces this with the Extensions API DataSource.id.
  // An empty value is unbound: do not fall back to the first datasource.
  var BOUND_DATASOURCE_ID = '';

  function requireDataArray(result, label) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.data)) {
      throw new Error(label + ' returned an invalid response. Expected { data: [...] }.');
    }
    return result.data;
  }

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

  function findDataSource(list) {
    if (!BOUND_DATASOURCE_ID) {
      throw new Error('No datasource is bound. Set BOUND_DATASOURCE_ID to the Extensions API DataSource.id.');
    }
    var found = null;
    (list || []).forEach(function (ds) {
      if (ds && ds.id === BOUND_DATASOURCE_ID) {
        found = ds;
      }
    });
    if (!found) {
      var ids = (list || []).map(function (ds) { return ds && ds.id; }).filter(Boolean);
      throw new Error(
        'Datasource "' + BOUND_DATASOURCE_ID + '" is not in this workbook. Available: ' +
        (ids.length ? ids.join(', ') : '(none)')
      );
    }
    return found;
  }

  function renderError(msg) {
    root.textContent = '';
    var p = document.createElement('p');
    p.className = 'error';
    p.textContent = msg;
    root.appendChild(p);
  }

  function renderStarter(ds, fields) {
    root.textContent = '';
    var h = document.createElement('h1');
    h.textContent = ds.name || ds.id;
    root.appendChild(h);
    var note = document.createElement('p');
    if (fields.length === 0) {
      note.textContent = 'Metadata returned 0 fields. That is an empty result, not a failed read.';
    } else {
      note.textContent = 'Metadata returned ' + fields.length +
        ' fields. No queryAsync call is authored yet. Author a query from these fields before treating the app as complete.';
    }
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
    if (!root) {
      return;
    }
    tableau.extensions.initializeAsync().then(function () {
      return getDataSources();
    }).then(function (list) {
      var ds = findDataSource(list);
      if (typeof ds.readMetadataAsync !== 'function') {
        throw new Error('readMetadataAsync is not available on the bound datasource.');
      }
      if (typeof ds.queryAsync !== 'function') {
        throw new Error('queryAsync is not available on the bound datasource.');
      }
      return ds.readMetadataAsync().then(function (metadata) {
        var fields = requireDataArray(metadata, 'readMetadataAsync');
        // ---------------------------------------------------------------------------------------
        // AUTHOR YOUR APP HERE.
        //   1. Build a VDS query from the fields above, then call ds.queryAsync(query).
        //      A resolved { data: [] } is a real zero-row result. A rejection or a body
        //      without a data array is a failure: show it, do not render an empty chart.
        //   2. Default charting library: Vega-Lite. Vendor it locally (no CDN).
        //   3. For plain text/DOM use textContent / createElement.
        // ---------------------------------------------------------------------------------------
        renderStarter(ds, fields);
      });
    }).catch(function (err) {
      renderError((err && (err.message || err.errorCode)) || String(err));
    });
  }

  boot();
})();
