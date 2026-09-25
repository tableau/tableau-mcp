import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockView } from '../views/mockView.js';
import { exportedForTesting, filterWorkbookViews, getGetWorkbookTool } from './getWorkbook.js';
import { mockWorkbook } from './mockWorkbook.js';

const { getDefaultViewWebUrl } = exportedForTesting;

const { usage: _usage, ...mockViewWithoutUsage } = mockView;
const mockWorkbookWithFlattenedViewUsage = {
  ...mockWorkbook,
  views: {
    view: [{ ...mockViewWithoutUsage, totalViewCount: 42 }],
  },
};

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockQueryViewsForWorkbook: vi.fn(),
  mockQueryWorkbookConnections: vi.fn(),
  mockGraphql: vi.fn(),
  mockUserHasQueryPermissions: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
        queryWorkbookConnections: mocks.mockQueryWorkbookConnections,
      },
      viewsMethods: {
        queryViewsForWorkbook: mocks.mockQueryViewsForWorkbook,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
      },
      vizqlDataServiceMethods: {
        userHasQueryPermissions: mocks.mockUserHasQueryPermissions,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

const emptyWorkbookLineage = { data: { workbooksConnection: { nodes: [] } } };

describe('getWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    // Safe defaults: no connections, empty published lineage, and an indeterminate
    // has-query-permissions result so isQueryable is left unset and stays out of the
    // discovery/merge assertions below. Queryability mapping (including feature-disabled → unset and
    // workbook-datasource-not-enabled → false) is exercised in the 'isQueryable enrichment' block.
    mocks.mockQueryWorkbookConnections.mockResolvedValue([]);
    mocks.mockGraphql.mockResolvedValue(emptyWorkbookLineage);
    mocks.mockUserHasQueryPermissions.mockResolvedValue(
      Err({
        type: 'api-error',
        message: 'queryability not under test',
        httpStatus: 503,
        errorCode: '503800',
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const getWorkbookTool = getGetWorkbookTool(new WebMcpServer());
    expect(getWorkbookTool.name).toBe('get-workbook');
    expect(getWorkbookTool.description).toContain(
      'Retrieves information about the specified workbook',
    );
    expect(getWorkbookTool.paramsSchema).toMatchObject({ workbookId: expect.any(Object) });
  });

  it('should successfully get workbook', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    mocks.mockQueryViewsForWorkbook.mockResolvedValue([mockView]);
    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const response = JSON.parse(result.content[0].text);
    expect(response.data).toBeDefined();
    expect(response.url).toBeDefined();
    expect(response.data.id).toBe('96a43833-27db-40b6-aa80-751efc776b9a');
    expect(response.data.name).toBe('Superstore');
    expect(response.data.views.view).toHaveLength(1);
    expect(response.data.views.view[0].totalViewCount).toBe(42);
    expect(response.data.views.view[0].usage).toBeUndefined(); // should be flattened
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );

    expect(mocks.mockGetWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });
    expect(mocks.mockQueryViewsForWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeUsageStatistics: true,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGetWorkbook.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ workbookId: '96a43833-27db-40b6-aa80-751efc776b9a' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return workbook not allowed error when workbook is not allowed', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');
    mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult({ workbookId: mockWorkbook.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        'Querying the workbook with LUID 96a43833-27db-40b6-aa80-751efc776b9a is not allowed.',
      ].join(' '),
    );

    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockQueryViewsForWorkbook).not.toHaveBeenCalled();
  });

  describe('upstream datasource enrichment', () => {
    const workbookId = '96a43833-27db-40b6-aa80-751efc776b9a';

    beforeEach(() => {
      mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
      mocks.mockQueryViewsForWorkbook.mockResolvedValue([mockView]);
    });

    it('enriches with embedded datasources from a single /connections call', async () => {
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledTimes(1);
      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledWith({
        workbookId,
        siteId: 'test-site-id',
      });
      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('combines published (metadata) and embedded entries, tagging each type', async () => {
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'pub-luid-1', name: 'Published DS', datasourceType: 'published' },
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('attaches a publishedParent pointer and drops the redundant standalone published entry', async () => {
      // A live connection to a published DS surfaces as both the recovered published entry
      // (pub-luid-1) and the sqlproxy embedded stub (emb-luid-1). The stub carries the
      // publishedParent pointer, so the standalone published entry is de-duped away.
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                embeddedDatasources: [
                  {
                    name: 'Embedded DS',
                    parentPublishedDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                  },
                ],
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          publishedParent: { luid: 'pub-luid-1', name: 'Published DS' },
        },
      ]);
    });

    it('keeps an allowed published DS when its embedded stub is out of the bounded context', async () => {
      // Regression guard: the de-dupe must not let an out-of-bounds embedded stub suppress its
      // in-bounds published parent. Only pub-luid-1 is allowed; the emb-luid-1 stub is not.
      vi.stubEnv('INCLUDE_DATASOURCE_IDS', 'pub-luid-1');
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                embeddedDatasources: [
                  {
                    name: 'Embedded DS',
                    parentPublishedDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                  },
                ],
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'pub-luid-1', name: 'Published DS', datasourceType: 'published' },
      ]);
    });

    it('omits the publishedParent when two connections share an embedded name across LUIDs', async () => {
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [],
                embeddedDatasources: [
                  {
                    name: 'Embedded DS',
                    parentPublishedDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
                  },
                ],
              },
            ],
          },
        },
      });
      // Same embedded name, distinct LUIDs -> name->LUID join is ambiguous, so neither entry
      // may claim the authoritative parent.
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
        { id: 'conn-2', datasource: { id: 'emb-luid-2', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
        { luid: 'emb-luid-2', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('does not attach a publishedParent when the Metadata API is disabled', async () => {
      vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'true');
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('falls back to the luid when a connection datasource has no name', async () => {
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'emb-luid-1', datasourceType: 'embedded' },
      ]);
    });

    it('surfaces embedded datasources without calling the Metadata API when it is disabled', async () => {
      vi.stubEnv('DISABLE_METADATA_API_REQUESTS', 'true');
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);

      const response = await getResponseData({ workbookId });

      expect(mocks.mockGraphql).not.toHaveBeenCalled();
      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledTimes(1);
      expect(response.data.upstreamDatasources).toEqual([
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('swallows a failed /connections call and still returns the workbook', async () => {
      mocks.mockQueryWorkbookConnections.mockRejectedValue(new Error('connections boom'));

      const response = await getResponseData({ workbookId });

      expect(response.data.id).toBe(workbookId);
      expect(response.data.upstreamDatasources).toBeUndefined();
    });
  });

  describe('queryability enrichment', () => {
    const workbookId = '96a43833-27db-40b6-aa80-751efc776b9a';

    beforeEach(() => {
      mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
      mocks.mockQueryViewsForWorkbook.mockResolvedValue([mockView]);
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: [{ luid: 'pub-luid-1', name: 'Published DS' }],
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'conn-1', datasource: { id: 'emb-luid-1', name: 'Embedded DS' } },
      ]);
    });

    it('skips the permission calls when the workbook has zero upstream datasources', async () => {
      // No connections and empty lineage → no upstream datasources, so enrichment early-returns
      // without hitting the has-query-permissions endpoint at all.
      mocks.mockGraphql.mockResolvedValue(emptyWorkbookLineage);
      mocks.mockQueryWorkbookConnections.mockResolvedValue([]);

      const response = await getResponseData({ workbookId });

      expect(mocks.mockUserHasQueryPermissions).not.toHaveBeenCalled();
      expect(response.data.upstreamDatasources ?? []).toEqual([]);
    });

    it('omits queryability for every datasource when the endpoint is absent (feature-disabled)', async () => {
      // feature-disabled = the user-has-query-permissions endpoint is absent on an older server, so
      // the API can't answer for any data source. Queryability is undeterminable, so the queryability
      // object is omitted for both published and embedded. Since the first (probe) check already
      // proves the systemic failure, the remaining data sources are skipped without another call —
      // exactly one call total.
      mocks.mockUserHasQueryPermissions.mockResolvedValue(Err({ type: 'feature-disabled' }));

      const response = await getResponseData({ workbookId });

      expect(mocks.mockUserHasQueryPermissions).toHaveBeenCalledTimes(1);
      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
        },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
        },
      ]);
    });

    it('sets queryability false with a reason for every datasource when the workbook-datasource feature is off (workbook-datasource-not-enabled)', async () => {
      // workbook-datasource-not-enabled = the VDSForWorkbookDatasources feature is off site-wide. The
      // endpoint answered but querying is disabled for every data source, so isQueryable is false for
      // both published and embedded, with a systemic reason. The probe proves the systemic failure, so
      // the rest are skipped without another call — exactly one call total.
      mocks.mockUserHasQueryPermissions.mockResolvedValue(
        Err({ type: 'workbook-datasource-not-enabled' }),
      );

      const response = await getResponseData({ workbookId });

      expect(mocks.mockUserHasQueryPermissions).toHaveBeenCalledTimes(1);
      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: {
            isQueryable: false,
            reason:
              'Querying workbook (embedded) data sources is not enabled for this Tableau site.',
          },
        },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          queryability: {
            isQueryable: false,
            reason:
              'Querying workbook (embedded) data sources is not enabled for this Tableau site.',
          },
        },
      ]);
    });

    it('sets queryability true on success and false with a generic reason when no capabilities are returned', async () => {
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        Ok({ hasQueryPermission: datasource.datasourceLuid === 'pub-luid-1' }),
      );

      const response = await getResponseData({ workbookId });

      expect(mocks.mockUserHasQueryPermissions).toHaveBeenCalledTimes(2);
      expect(mocks.mockUserHasQueryPermissions).toHaveBeenCalledWith({
        datasource: { datasourceLuid: 'pub-luid-1' },
      });
      expect(mocks.mockUserHasQueryPermissions).toHaveBeenCalledWith({
        datasource: { datasourceLuid: 'emb-luid-1' },
      });
      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          queryability: {
            isQueryable: false,
            reason: 'The user does not have permission to query this data source.',
          },
        },
      ]);
    });

    it('sets queryability false with a reason built from the denied capabilities VDS returns', async () => {
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        datasource.datasourceLuid === 'pub-luid-1'
          ? Ok({ hasQueryPermission: true })
          : Ok({
              hasQueryPermission: false,
              datasourceType: 'WORKBOOK',
              resources: [
                {
                  resourceType: 'Datasource',
                  luid: 'upstream-pds-1',
                  capabilities: [
                    { name: 'Read', mode: 'Allow' },
                    { name: 'Connect', mode: 'Deny' },
                    { name: 'VizqlDataApiAccess', mode: 'Deny' },
                  ],
                },
              ],
            }),
      );

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          queryability: {
            isQueryable: false,
            reason:
              'The user is missing required permissions: Connect, VizqlDataApiAccess on Datasource upstream-pds-1.',
          },
        },
      ]);
    });

    it('caps in-flight has-query-permissions calls at 5 when fanning out many datasources', async () => {
      // A workbook with many upstream datasources must not fire an unbounded burst of VDS calls; the
      // fan-out is batched so at most 5 checks are in flight at once (the probe runs first, on its own).
      const datasourceCount = 12;
      mocks.mockGraphql.mockResolvedValue({
        data: {
          workbooksConnection: {
            nodes: [
              {
                luid: workbookId,
                upstreamDatasources: Array.from({ length: datasourceCount }, (_, i) => ({
                  luid: `pub-luid-${i + 1}`,
                  name: `Published DS ${i + 1}`,
                })),
              },
            ],
          },
        },
      });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([]);

      let inFlight = 0;
      let peak = 0;
      mocks.mockUserHasQueryPermissions.mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        return Ok({ hasQueryPermission: true });
      });

      const response = await getResponseData({ workbookId });

      expect(mocks.mockUserHasQueryPermissions).toHaveBeenCalledTimes(datasourceCount);
      expect(peak).toBe(5);
      expect(response.data.upstreamDatasources).toHaveLength(datasourceCount);
    });

    it("sets queryability false and surfaces VDS's message when the check returns 403 (no permission)", async () => {
      // A 403 (Forbidden, e.g. errorCode 403800 "does not have permission") means VDS authenticated
      // the caller and denied query access → isQueryable is false. VDS's own message names the
      // specific data source, so we surface it rather than a generic reason.
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        datasource.datasourceLuid === 'pub-luid-1'
          ? Ok({ hasQueryPermission: true })
          : Err({
              type: 'api-error',
              message:
                'The user does not have permission to view query permissions for data source emb-luid-1.',
              httpStatus: 403,
              errorCode: '403800',
            }),
      );

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          queryability: {
            isQueryable: false,
            reason:
              'The user does not have permission to view query permissions for data source emb-luid-1.',
          },
        },
      ]);
    });

    it("sets queryability false and surfaces VDS's message when the data source is not found (404 / errorCode 404937)", async () => {
      // A 404937 is scoped to the requested data source (it no longer exists), unlike the
      // missing-endpoint 404950 which is systemic. The data source can't be queried → false, with
      // VDS's own message surfaced as the reason.
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        datasource.datasourceLuid === 'pub-luid-1'
          ? Ok({ hasQueryPermission: true })
          : Err({
              type: 'api-error',
              message: 'Datasource not found.',
              httpStatus: 404,
              errorCode: '404937',
            }),
      );

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        {
          luid: 'emb-luid-1',
          name: 'Embedded DS',
          datasourceType: 'embedded',
          queryability: {
            isQueryable: false,
            reason: 'Datasource not found.',
          },
        },
      ]);
    });

    it('omits queryability when the check fails authentication (401)', async () => {
      // A 401 means authentication/scope failed, not that VDS evaluated permissions and denied
      // them (e.g. a deployment whose token lacks the viz_data_service scope). That's
      // indeterminate, so queryability is omitted rather than being falsely reported as false.
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        datasource.datasourceLuid === 'pub-luid-1'
          ? Ok({ hasQueryPermission: true })
          : Err({
              type: 'api-error',
              message: 'Invalid authentication credentials.',
              httpStatus: 401,
              errorCode: '401002',
            }),
      );

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('omits queryability when the check returns a transient HTTP error (e.g. 503)', async () => {
      // Rate-limit / server errors are transient failures, not a permission verdict, so they stay
      // indeterminate rather than being reported as false (matches how query-datasource treats them).
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        datasource.datasourceLuid === 'pub-luid-1'
          ? Ok({ hasQueryPermission: true })
          : Err({
              type: 'api-error',
              message: 'The underlying data engine is unavailable.',
              httpStatus: 503,
              errorCode: '503800',
            }),
      );

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('omits queryability when the check fails without an HTTP response (zodios-error)', async () => {
      // A transport or schema-parse failure isn't evidence the user can't query, so it stays
      // indeterminate (omitted) rather than being reported as false.
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) =>
        datasource.datasourceLuid === 'pub-luid-1'
          ? Ok({ hasQueryPermission: true })
          : Err({ type: 'zodios-error', error: new Error('parse boom') }),
      );

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });

    it('omits queryability (and still returns the workbook) when the check throws', async () => {
      // A thrown error (e.g. a network failure) must not fail get-workbook — enrichment is best-effort.
      mocks.mockUserHasQueryPermissions.mockImplementation(async ({ datasource }) => {
        if (datasource.datasourceLuid === 'pub-luid-1') {
          return Ok({ hasQueryPermission: true });
        }
        throw new Error('network boom');
      });

      const response = await getResponseData({ workbookId });

      expect(response.data.upstreamDatasources).toEqual([
        {
          luid: 'pub-luid-1',
          name: 'Published DS',
          datasourceType: 'published',
          queryability: { isQueryable: true },
        },
        { luid: 'emb-luid-1', name: 'Embedded DS', datasourceType: 'embedded' },
      ]);
    });
  });

  describe('buildQueryabilityReason', () => {
    const { buildQueryabilityReason } = exportedForTesting;

    it('returns undefined when there are no resources to explain the denial', () => {
      expect(buildQueryabilityReason(undefined)).toBeUndefined();
      expect(buildQueryabilityReason([])).toBeUndefined();
    });

    it('returns undefined when no resource has a denied capability', () => {
      // A resource with no capabilities, and one that grants everything, both contribute nothing.
      expect(
        buildQueryabilityReason([
          { resourceType: 'Datasource', luid: 'ds-1' },
          {
            resourceType: 'Workbook',
            luid: 'wb-1',
            capabilities: [{ name: 'Read', mode: 'Allow' }],
          },
        ]),
      ).toBeUndefined();
    });

    it('lists only the denied capabilities, omitting a resource that grants all of them', () => {
      // The workbook grants everything (omitted); the datasource denies two (only those are listed).
      const reason = buildQueryabilityReason([
        {
          resourceType: 'Workbook',
          luid: 'wb-1',
          capabilities: [
            { name: 'Read', mode: 'Allow' },
            { name: 'Connect', mode: 'Allow' },
            { name: 'VizqlDataApiAccess', mode: 'Allow' },
          ],
        },
        {
          resourceType: 'Datasource',
          luid: 'ds-1',
          capabilities: [
            { name: 'Read', mode: 'Allow' },
            { name: 'Connect', mode: 'Deny' },
            { name: 'VizqlDataApiAccess', mode: 'Deny' },
          ],
        },
      ]);

      expect(reason).toBe(
        'The user is missing required permissions: Connect, VizqlDataApiAccess on Datasource ds-1.',
      );
    });

    it("joins multiple resources with '; ' when each is missing capabilities", () => {
      // Both resources have denials (doc case #2): the workbook denies two, the datasource denies all.
      const reason = buildQueryabilityReason([
        {
          resourceType: 'Workbook',
          luid: 'wb-1',
          capabilities: [
            { name: 'Read', mode: 'Allow' },
            { name: 'Connect', mode: 'Deny' },
            { name: 'VizqlDataApiAccess', mode: 'Deny' },
          ],
        },
        {
          resourceType: 'Datasource',
          luid: 'ds-1',
          capabilities: [
            { name: 'Read', mode: 'Deny' },
            { name: 'Connect', mode: 'Deny' },
            { name: 'VizqlDataApiAccess', mode: 'Deny' },
          ],
        },
      ]);

      expect(reason).toBe(
        'The user is missing required permissions: Connect, VizqlDataApiAccess on Workbook wb-1; ' +
          'Read, Connect, VizqlDataApiAccess on Datasource ds-1.',
      );
    });

    // resourceType and luid are optional in the VDS wire schema, so the reason text must degrade
    // gracefully on a partial resource and never leak the literal "undefined".
    it.each([
      {
        name: 'a luid but no resourceType',
        resources: [{ luid: 'ds-1', capabilities: [{ name: 'Connect', mode: 'Deny' as const }] }],
        expected: 'The user is missing required permissions: Connect on data source ds-1.',
      },
      {
        name: 'a resourceType but no luid',
        resources: [
          { resourceType: 'Workbook', capabilities: [{ name: 'Read', mode: 'Deny' as const }] },
        ],
        expected: 'The user is missing required permissions: Read on Workbook.',
      },
      {
        name: 'neither a resourceType nor a luid',
        resources: [{ capabilities: [{ name: 'Read', mode: 'Deny' as const }] }],
        expected: 'The user is missing required permissions: Read on this data source.',
      },
    ])('names the resource sensibly given $name', ({ resources, expected }) => {
      const reason = buildQueryabilityReason(resources);
      expect(reason).toBe(expected);
      expect(reason).not.toContain('undefined');
    });
  });

  describe('getDefaultViewWebUrl', () => {
    const server = 'https://my-tableau-server.com';
    const siteName = 'tc25';

    it('should return URL for default view when it exists', () => {
      const workbook = {
        ...mockWorkbook,
        defaultViewId: mockView.id,
        views: { view: [mockView] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBe('https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview');
    });

    it('should fall back to first view when default view is not found', () => {
      const mockView2 = {
        ...mockView,
        id: 'other-view-id',
        contentUrl: 'Superstore/OtherView',
      };

      const workbook = {
        ...mockWorkbook,
        defaultViewId: 'non-existent-view-id', // Default view not in the list
        views: { view: [mockView2] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBe('https://my-tableau-server.com/#/site/tc25/views/Superstore/OtherView');
    });

    it('should use first view when workbook has no defaultViewId', () => {
      const workbook = {
        ...mockWorkbook,
        defaultViewId: undefined,
        views: { view: [mockView] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBe('https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview');
    });

    it('should return undefined when workbook has no views', () => {
      const workbook = {
        ...mockWorkbook,
        views: { view: [] },
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBeUndefined();
    });

    it('should return undefined when workbook views is undefined', () => {
      const workbook = {
        ...mockWorkbook,
        views: undefined,
      };

      const url = getDefaultViewWebUrl(workbook, server, siteName);

      expect(url).toBeUndefined();
    });
  });

  describe('filterWorkbookViews', () => {
    it('should return the workbook when no filtering occurs', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });
      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should return the views that match the tags in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: new Set(['tag-1']),
        },
      });

      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should remove views from the workbook when all views were filtered out by the tags in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: new Set(['some-other-tag']),
        },
      });

      expect(result).toEqual({
        ...mockWorkbook,
        views: { view: [] },
      });
    });

    it('should return the views that match viewIds in the bounded context', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: null,
        },
      });

      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should remove views from the workbook when all views are filtered out by viewIds', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set(['some-other-view-id']),
          tags: null,
        },
      });

      expect(result).toEqual({
        ...mockWorkbook,
        views: { view: [] },
      });
    });

    it('should apply both viewIds and tags filters in conjunction (AND)', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: new Set(['tag-1']),
        },
      });

      expect(result).toEqual(mockWorkbookWithFlattenedViewUsage);
    });

    it('should remove views when viewIds matches but tags do not', () => {
      const result = filterWorkbookViews({
        workbook: mockWorkbook,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: new Set([mockView.id]),
          tags: new Set(['some-other-tag']),
        },
      });

      expect(result).toEqual({
        ...mockWorkbook,
        views: { view: [] },
      });
    });
  });
});

async function getToolResult(params: { workbookId: string }): Promise<CallToolResult> {
  const getWorkbookTool = getGetWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(getWorkbookTool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}

async function getResponseData(params: { workbookId: string }): Promise<any> {
  const result = await getToolResult(params);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
