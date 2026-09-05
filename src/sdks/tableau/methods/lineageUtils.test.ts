import {
  getSearchContentLineageQuery,
  getViewLineageByLuid,
  getViewLineageQuery,
  getWorkbookLineageByLuid,
  getWorkbookLineageQuery,
  mergeViewLineage,
  mergeWorkbookLineage,
  reconcileWorkbookDatasources,
  toEmbeddedLineageContents,
} from './lineageUtils.js';

describe('lineageUtils', () => {
  it('maps workbook connections to embedded lineage, deduping multi-connection datasources', () => {
    const result = toEmbeddedLineageContents([
      { id: 'conn-1', datasource: { id: 'emb-1', name: 'Embedded DS' } },
      { id: 'conn-2', datasource: { id: 'emb-1', name: 'Embedded DS' } }, // same ds, second connection
      { id: 'conn-3', datasource: { id: 'emb-2' } }, // missing name -> luid fallback
      { id: 'conn-4' }, // no datasource -> skipped
    ]);

    expect(result).toEqual([
      { luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' },
      { luid: 'emb-2', name: 'emb-2', datasourceType: 'embedded' },
    ]);
  });

  describe('reconcileWorkbookDatasources', () => {
    it('reclassifies a connection as published when a published upstream shares its name', () => {
      // The sqlproxy connection (emb-superstore) and the published datasource (pub-superstore) are
      // the same datasource; emit one entry keyed on the connection LUID, tagged published.
      const result = reconcileWorkbookDatasources(
        [
          { luid: 'emb-superstore', name: 'Superstore Datasource', datasourceType: 'embedded' },
          { luid: 'emb-logbk', name: 'log_bk', datasourceType: 'embedded' },
        ],
        [{ luid: 'pub-superstore', name: 'Superstore Datasource' }],
      );

      expect(result).toEqual([
        { luid: 'emb-superstore', name: 'Superstore Datasource', datasourceType: 'published' },
        { luid: 'emb-logbk', name: 'log_bk', datasourceType: 'embedded' },
      ]);
    });

    it('appends a published upstream that no connection accounts for', () => {
      const result = reconcileWorkbookDatasources(
        [{ luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' }],
        [{ luid: 'pub-1', name: 'Published DS' }],
      );

      expect(result).toEqual([
        { luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' },
        { luid: 'pub-1', name: 'Published DS', datasourceType: 'published' },
      ]);
    });

    it('leaves connections embedded when there is no published lineage', () => {
      const result = reconcileWorkbookDatasources(
        [{ luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' }],
        [],
      );

      expect(result).toEqual([{ luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' }]);
    });
  });

  it('parses and merges upstream workbook lineage', () => {
    const lineageByLuid = getWorkbookLineageByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              upstreamDatasources: [
                { luid: 'datasource-1', name: 'Sales' },
                { luid: 'datasource-2', name: 'Finance' },
              ],
            },
          ],
        },
      },
    });

    const result = mergeWorkbookLineage(
      [{ id: 'workbook-1', name: 'Workbook' }],
      lineageByLuid,
      new Set(['datasource-1']),
    );

    expect(result).toEqual([
      {
        id: 'workbook-1',
        name: 'Workbook',
        upstreamDatasources: [{ luid: 'datasource-1', name: 'Sales' }],
      },
    ]);
  });

  it('surfaces published datasources via embeddedDatasources when the workbook rollup is empty', () => {
    // Reproduces the real-world case: Workbook.upstreamDatasources returns [] even though the
    // embedded datasource is live-connected to a published datasource that Catalog has indexed.
    const lineageByLuid = getWorkbookLineageByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              upstreamDatasources: [],
              embeddedDatasources: [
                { upstreamDatasources: [{ luid: 'pub-1', name: 'Superstore Datasource' }] },
                { upstreamDatasources: [] }, // pure embedded (e.g. a text file) -> nothing upstream
              ],
            },
          ],
        },
      },
    });

    expect(lineageByLuid.get('workbook-1')).toEqual([
      { luid: 'pub-1', name: 'Superstore Datasource' },
    ]);
  });

  it('dedupes published datasources surfaced by both the rollup and embeddedDatasources', () => {
    const lineageByLuid = getWorkbookLineageByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              upstreamDatasources: [{ luid: 'pub-1', name: 'Sales' }],
              embeddedDatasources: [
                { upstreamDatasources: [{ luid: 'pub-1', name: 'Sales' }] }, // duplicate
                { upstreamDatasources: [{ luid: 'pub-2', name: 'Finance' }] },
              ],
            },
          ],
        },
      },
    });

    expect(lineageByLuid.get('workbook-1')).toEqual([
      { luid: 'pub-1', name: 'Sales' },
      { luid: 'pub-2', name: 'Finance' },
    ]);
  });

  it('includes embeddedDatasources traversal in the workbook lineage query', () => {
    expect(getWorkbookLineageQuery(['workbook-1'])).toContain('embeddedDatasources');
  });

  it('parses and merges view lineage with workbook name', () => {
    const lineageByLuid = getViewLineageByLuid({
      data: {
        sheetsConnection: {
          nodes: [
            {
              luid: 'view-1',
              upstreamDatasources: [
                { luid: 'datasource-1', name: 'Sales' },
                { name: 'Embedded Datasource' },
              ],
              workbook: {
                luid: 'workbook-1',
                name: 'Executive Dashboard',
                projectLuid: 'project-1',
                projectName: 'Executive Project',
                owner: { luid: 'owner-1', name: 'Workbook Owner' },
              },
            },
          ],
        },
      },
    });

    const result = mergeViewLineage(
      [{ id: 'view-1', workbook: { id: 'workbook-1' }, owner: {}, project: {} }],
      lineageByLuid,
    );

    expect(result).toEqual([
      {
        id: 'view-1',
        workbook: { id: 'workbook-1', name: 'Executive Dashboard' },
        owner: { id: 'owner-1', name: 'Workbook Owner' },
        project: { id: 'project-1', name: 'Executive Project' },
        upstreamDatasources: [{ luid: 'datasource-1', name: 'Sales' }],
      },
    ]);
  });

  it('surfaces published datasources for a view via its workbook embeddedDatasources', () => {
    const lineageByLuid = getViewLineageByLuid({
      data: {
        sheetsConnection: {
          nodes: [
            {
              luid: 'view-1',
              upstreamDatasources: [], // sheet-level rollup empty (same Catalog gap as workbooks)
              workbook: {
                luid: 'workbook-1',
                name: 'Executive Dashboard',
                embeddedDatasources: [
                  { upstreamDatasources: [{ luid: 'pub-1', name: 'Superstore Datasource' }] },
                ],
              },
            },
          ],
        },
      },
    });

    const result = mergeViewLineage(
      [{ id: 'view-1', workbook: { id: 'workbook-1' } }],
      lineageByLuid,
    );

    expect(result).toEqual([
      {
        id: 'view-1',
        workbook: { id: 'workbook-1', name: 'Executive Dashboard' },
        upstreamDatasources: [{ luid: 'pub-1', name: 'Superstore Datasource' }],
      },
    ]);
  });

  it('queries both sheetsConnection and dashboardsConnection for view lineage', () => {
    const query = getViewLineageQuery(['view-1', 'dashboard-1']);

    expect(query).toContain('sheetsConnection(filter: { luidWithin: ["view-1", "dashboard-1"] })');
    expect(query).toContain(
      'dashboardsConnection(filter: { luidWithin: ["view-1", "dashboard-1"] })',
    );
  });

  it('queries both sheetsConnection and dashboardsConnection in search content lineage', () => {
    const query = getSearchContentLineageQuery({
      workbookLuids: [],
      viewLuids: ['view-1'],
    });

    expect(query).toContain('sheetsConnection(filter: { luidWithin: ["view-1"] })');
    expect(query).toContain('dashboardsConnection(filter: { luidWithin: ["view-1"] })');
  });

  it('parses and merges dashboard view lineage from dashboardsConnection', () => {
    const lineageByLuid = getViewLineageByLuid({
      data: {
        sheetsConnection: { nodes: [] },
        dashboardsConnection: {
          nodes: [
            {
              luid: 'dashboard-1',
              upstreamDatasources: [
                { luid: 'datasource-1', name: 'Data Depot' },
                { name: 'Embedded Datasource' },
              ],
              workbook: {
                luid: 'workbook-1',
                name: 'Customer Support',
                projectLuid: 'project-1',
                projectName: 'Support Project',
                owner: { luid: 'owner-1', name: 'Support Owner' },
              },
            },
          ],
        },
      },
    });

    const result = mergeViewLineage(
      [{ id: 'dashboard-1', workbook: { id: 'workbook-1' }, owner: {}, project: {} }],
      lineageByLuid,
    );

    expect(result).toEqual([
      {
        id: 'dashboard-1',
        workbook: { id: 'workbook-1', name: 'Customer Support' },
        owner: { id: 'owner-1', name: 'Support Owner' },
        project: { id: 'project-1', name: 'Support Project' },
        upstreamDatasources: [{ luid: 'datasource-1', name: 'Data Depot' }],
      },
    ]);
  });

  it('merges sheet and dashboard lineage nodes from a combined response', () => {
    const lineageByLuid = getViewLineageByLuid({
      data: {
        sheetsConnection: {
          nodes: [
            {
              luid: 'sheet-1',
              upstreamDatasources: [{ luid: 'ds-sheet', name: 'Sheet DS' }],
            },
          ],
        },
        dashboardsConnection: {
          nodes: [
            {
              luid: 'dashboard-1',
              upstreamDatasources: [{ luid: 'ds-dash', name: 'Dashboard DS' }],
            },
          ],
        },
      },
    });

    expect(mergeViewLineage([{ id: 'sheet-1' }, { id: 'dashboard-1' }], lineageByLuid)).toEqual([
      {
        id: 'sheet-1',
        upstreamDatasources: [{ luid: 'ds-sheet', name: 'Sheet DS' }],
      },
      {
        id: 'dashboard-1',
        upstreamDatasources: [{ luid: 'ds-dash', name: 'Dashboard DS' }],
      },
    ]);
  });
});
