import {
  getDatasourceDownstreamLineageByLuid,
  getViewLineageByLuid,
  getWorkbookLineageByLuid,
  mergeDatasourceDownstreamWorkbooks,
  mergeViewLineage,
  mergeWorkbookLineage,
} from './lineageUtils.js';

describe('lineageUtils', () => {
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

  it('promotes user-owned and popular downstream workbooks, then fills remaining slots from lineage', () => {
    const downstreamWorkbookNodes: Array<{ luid: string; name?: string | null }> = Array.from<
      unknown,
      { luid: string; name?: string | null }
    >({ length: 12 }, (_, index) => ({
      luid: `workbook-${index + 1}`,
      name: `Workbook ${index + 1}`,
    })).concat([
      { luid: 'shadow-workbook-null', name: null },
      { luid: 'shadow-workbook-missing-name' },
    ]);

    const downstreamLineageByDatasourceLuid = getDatasourceDownstreamLineageByLuid({
      data: {
        publishedDatasourcesConnection: {
          nodes: [
            {
              luid: 'datasource-1',
              downstreamWorkbooksConnection: {
                totalCount: 12,
                nodes: downstreamWorkbookNodes,
              },
            },
          ],
        },
      },
    });

    const result = mergeDatasourceDownstreamWorkbooks({
      datasources: [
        {
          id: 'datasource-1',
          name: 'Datasource',
          project: { id: 'project-1', name: 'Project' },
          tags: {},
        },
      ],
      downstreamLineageByDatasourceLuid,
      popularWorkbooks: [
        { luid: 'workbook-11', name: 'Workbook 11', totalViewCount: 1000 },
        { luid: 'workbook-3', name: 'Workbook 3', totalViewCount: 500 },
      ],
      userOwnedWorkbooks: [{ luid: 'workbook-12', name: 'Workbook 12' }],
    });

    expect(result[0]).toMatchObject({
      downstreamWorkbookCount: 12,
      downstreamWorkbooks: [
        { luid: 'workbook-12', name: 'Workbook 12', ownedByCurrentUser: true },
        { luid: 'workbook-11', name: 'Workbook 11', ownedByCurrentUser: false },
        { luid: 'workbook-3', name: 'Workbook 3', ownedByCurrentUser: false },
        { luid: 'workbook-1', name: 'Workbook 1', ownedByCurrentUser: false },
        { luid: 'workbook-2', name: 'Workbook 2', ownedByCurrentUser: false },
        { luid: 'workbook-4', name: 'Workbook 4', ownedByCurrentUser: false },
        { luid: 'workbook-5', name: 'Workbook 5', ownedByCurrentUser: false },
        { luid: 'workbook-6', name: 'Workbook 6', ownedByCurrentUser: false },
        { luid: 'workbook-7', name: 'Workbook 7', ownedByCurrentUser: false },
        { luid: 'workbook-8', name: 'Workbook 8', ownedByCurrentUser: false },
      ],
    });
    expect(result[0].downstreamWorkbooks).toHaveLength(10);
  });
});
