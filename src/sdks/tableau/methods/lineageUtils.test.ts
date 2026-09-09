import {
  getSearchContentLineageQuery,
  getViewLineageByLuid,
  getViewLineageQuery,
  getWorkbookLineageByLuid,
  getWorkbookLineageQuery,
  getWorkbookLineageWithParentsByLuid,
  mergeViewLineage,
  mergeWorkbookDatasources,
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
    const lineageByLuid = getWorkbookLineageWithParentsByLuid({
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

    expect(lineageByLuid.get('workbook-1')?.embeddedParents).toEqual(
      new Map([['Has Parent', { luid: 'pub-1', name: 'Parent DS' }]]),
    );
  });

  it('drops a published parent when the same embedded name appears more than once', () => {
    const lineageByLuid = getWorkbookLineageWithParentsByLuid({
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

    expect(lineageByLuid.get('workbook-1')?.embeddedParents?.size).toBe(0);
  });

  it('falls back to the parent luid when the parent name is missing', () => {
    const lineageByLuid = getWorkbookLineageWithParentsByLuid({
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

    expect(lineageByLuid.get('workbook-1')?.embeddedParents).toEqual(
      new Map([['Named', { luid: 'pub-1', name: 'pub-1' }]]),
    );
  });

  it('dedupes a standalone published entry already carried as an embedded publishedParent', () => {
    const published = [
      { luid: 'pub-1', name: 'Published DS', datasourceType: 'published' as const },
    ];
    const embedded = [
      {
        luid: 'emb-1',
        name: 'Embedded DS',
        datasourceType: 'embedded' as const,
        publishedParent: { luid: 'pub-1', name: 'Published DS' },
      },
    ];

    expect(mergeWorkbookDatasources(published, embedded)).toEqual([
      {
        luid: 'emb-1',
        name: 'Embedded DS',
        datasourceType: 'embedded',
        publishedParent: { luid: 'pub-1', name: 'Published DS' },
      },
    ]);
  });

  it('keeps a standalone published entry with no embedded publishedParent claiming its luid', () => {
    const published = [
      { luid: 'pub-1', name: 'Published DS', datasourceType: 'published' as const },
    ];
    const embedded = [{ luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' as const }];

    expect(mergeWorkbookDatasources(published, embedded)).toEqual([
      { luid: 'pub-1', name: 'Published DS', datasourceType: 'published' },
      { luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' },
    ]);
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

  it('prefers a real datasource name over a luid fallback when the same luid appears in both sources', () => {
    // The content-level rollup can report a null name for a datasource that the embedded
    // traversal names properly. Dedupe must keep the real name, not the luid fallback.
    const lineageByLuid = getWorkbookLineageByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              upstreamDatasources: [{ luid: 'pub-1', name: null }], // rollup: no name
              embeddedDatasources: [
                { upstreamDatasources: [{ luid: 'pub-1', name: 'Superstore Datasource' }] },
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

  it('tolerates embedded datasources with missing or null upstreamDatasources', () => {
    const lineageByLuid = getWorkbookLineageByLuid({
      data: {
        workbooksConnection: {
          nodes: [
            {
              luid: 'workbook-1',
              upstreamDatasources: [{ luid: 'pub-1', name: 'Sales' }],
              embeddedDatasources: [
                {}, // no upstreamDatasources field at all -> nullish
                { upstreamDatasources: null }, // explicit null
              ],
            },
          ],
        },
      },
    });

    expect(lineageByLuid.get('workbook-1')).toEqual([{ luid: 'pub-1', name: 'Sales' }]);
  });

  it('includes embeddedDatasources traversal in the workbook lineage query', () => {
    expect(getWorkbookLineageQuery(['workbook-1'])).toContain('embeddedDatasources');
  });

  it('omits the embedded published-parent selection from the workbook lineage query by default', () => {
    const query = getWorkbookLineageQuery(['workbook-1']);
    expect(query).toContain('embeddedDatasources');
    expect(query).not.toContain('parentPublishedDatasources');
  });

  it('includes the embedded published-parent selection when includeEmbeddedParents is set', () => {
    const query = getWorkbookLineageQuery(['workbook-1'], { includeEmbeddedParents: true });
    expect(query).toContain('embeddedDatasources');
    expect(query).toContain('parentPublishedDatasources');
  });

  it('strips a publishedParent pointer whose luid is out of the allowed bounds', () => {
    const lineageByLuid = new Map([
      [
        'workbook-1',
        [
          {
            luid: 'emb-1',
            name: 'Embedded DS',
            datasourceType: 'embedded' as const,
            publishedParent: { luid: 'pub-1', name: 'Out Of Bounds Parent' },
          },
        ],
      ],
    ]);

    const result = mergeWorkbookLineage(
      [{ id: 'workbook-1', name: 'Workbook' }],
      lineageByLuid,
      new Set(['emb-1']), // parent pub-1 is not allowed
    );

    expect(result).toEqual([
      {
        id: 'workbook-1',
        name: 'Workbook',
        upstreamDatasources: [{ luid: 'emb-1', name: 'Embedded DS', datasourceType: 'embedded' }],
      },
    ]);
  });

  it('keeps a publishedParent pointer when both the entry and its parent are in bounds', () => {
    const parent = { luid: 'pub-1', name: 'Parent DS' };
    const lineageByLuid = new Map([
      [
        'workbook-1',
        [
          {
            luid: 'emb-1',
            name: 'Embedded DS',
            datasourceType: 'embedded' as const,
            publishedParent: parent,
          },
        ],
      ],
    ]);

    const result = mergeWorkbookLineage(
      [{ id: 'workbook-1', name: 'Workbook' }],
      lineageByLuid,
      new Set(['emb-1', 'pub-1']),
    );

    expect(result).toEqual([
      {
        id: 'workbook-1',
        name: 'Workbook',
        upstreamDatasources: [
          {
            luid: 'emb-1',
            name: 'Embedded DS',
            datasourceType: 'embedded',
            publishedParent: parent,
          },
        ],
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

  it('keeps view lineage sheet-scoped and does not traverse workbook-wide embeddedDatasources', () => {
    // Regression guard for over-attribution: a view must report only the datasources its own sheet
    // uses. Traversing the parent workbook's embeddedDatasources would attribute every published
    // datasource in the workbook to every sheet, so the view/search queries must not request it.
    expect(getViewLineageQuery(['view-1'])).not.toContain('embeddedDatasources');
    expect(
      getSearchContentLineageQuery({ workbookLuids: [], viewLuids: ['view-1'] }),
    ).not.toContain('embeddedDatasources');
  });

  it('includes embeddedDatasources traversal for workbooks in the search content query', () => {
    // The workbook path IS workbook-scoped, so surfacing published datasources via embedded
    // datasources is correct there (unlike the view path above).
    expect(
      getSearchContentLineageQuery({ workbookLuids: ['workbook-1'], viewLuids: [] }),
    ).toContain('embeddedDatasources');
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
