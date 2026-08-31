import {
  getSearchContentLineageQuery,
  getViewLineageByLuid,
  getViewLineageQuery,
  getWorkbookEmbeddedParentsByLuid,
  getWorkbookLineageByLuid,
  mergeViewLineage,
  mergeWorkbookLineage,
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

  it('attaches a publishedParent pointer to embedded entries by name', () => {
    const result = toEmbeddedLineageContents(
      [
        { id: 'conn-1', datasource: { id: 'emb-1', name: 'Embedded DS' } },
        { id: 'conn-2', datasource: { id: 'emb-2', name: 'Orphan DS' } },
      ],
      new Map([['Embedded DS', { luid: 'pub-1', name: 'Parent DS' }]]),
    );

    expect(result).toEqual([
      {
        luid: 'emb-1',
        name: 'Embedded DS',
        datasourceType: 'embedded',
        publishedParent: { luid: 'pub-1', name: 'Parent DS' },
      },
      { luid: 'emb-2', name: 'Orphan DS', datasourceType: 'embedded' },
    ]);
  });

  it('omits the publishedParent pointer when the embedded name is ambiguous across LUIDs', () => {
    const result = toEmbeddedLineageContents(
      [
        { id: 'conn-1', datasource: { id: 'emb-1', name: 'Dup DS' } },
        { id: 'conn-2', datasource: { id: 'emb-2', name: 'Dup DS' } },
      ],
      new Map([['Dup DS', { luid: 'pub-1', name: 'Parent DS' }]]),
    );

    expect(result).toEqual([
      { luid: 'emb-1', name: 'Dup DS', datasourceType: 'embedded' },
      { luid: 'emb-2', name: 'Dup DS', datasourceType: 'embedded' },
    ]);
  });

  it('builds an authoritative embedded->published-parent map keyed by embedded name', () => {
    const parentsByLuid = getWorkbookEmbeddedParentsByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              embeddedDatasources: [
                {
                  name: 'Has Parent',
                  parentPublishedDatasources: [{ luid: 'pub-1', name: 'Parent DS' }],
                },
                { name: 'No Parent', parentPublishedDatasources: [] },
                {
                  name: 'Multi Parent',
                  parentPublishedDatasources: [
                    { luid: 'pub-2', name: 'A' },
                    { luid: 'pub-3', name: 'B' },
                  ],
                },
                { name: 'Missing Luid', parentPublishedDatasources: [{ name: 'No Luid' }] },
              ],
            },
          ],
        },
      },
    });

    expect(parentsByLuid.get('workbook-1')).toEqual(
      new Map([['Has Parent', { luid: 'pub-1', name: 'Parent DS' }]]),
    );
  });

  it('drops a published parent when the same embedded name appears more than once', () => {
    const parentsByLuid = getWorkbookEmbeddedParentsByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              embeddedDatasources: [
                { name: 'Dup', parentPublishedDatasources: [{ luid: 'pub-1', name: 'A' }] },
                { name: 'Dup', parentPublishedDatasources: [{ luid: 'pub-2', name: 'B' }] },
              ],
            },
          ],
        },
      },
    });

    expect(parentsByLuid.get('workbook-1')?.size).toBe(0);
  });

  it('falls back to the parent luid when the parent name is missing', () => {
    const parentsByLuid = getWorkbookEmbeddedParentsByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              embeddedDatasources: [
                { name: 'Named', parentPublishedDatasources: [{ luid: 'pub-1' }] },
              ],
            },
          ],
        },
      },
    });

    expect(parentsByLuid.get('workbook-1')).toEqual(
      new Map([['Named', { luid: 'pub-1', name: 'pub-1' }]]),
    );
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
