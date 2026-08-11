import { ExternalApiHttp } from './externalApiHttp.js';
import { MockExternalApiServer, startMockExternalApiServer } from './mockExternalApiServer.js';
import {
  apiRootSchema,
  appInfoSchema,
  dashboardDocumentRoute,
  dashboardItemSchema,
  dashboardListSchema,
  dashboardRoute,
  datasourceListSchema,
  EXTERNAL_API_ROUTES,
  ExternalApiInstance,
  logicalTableListSchema,
  sheetActionRoute,
  siteDatasourceListSchema,
  siteSchema,
  siteWorkbookListSchema,
  storyboardDocumentRoute,
  storyboardItemSchema,
  storyboardListSchema,
  storyboardRoute,
  summaryDataSchema,
  validationResultSchema,
  workbookInventorySchema,
  worksheetDocumentRoute,
  worksheetItemSchema,
  worksheetListSchema,
  worksheetLogicalTableDataRoute,
  worksheetLogicalTablesRoute,
  worksheetRoute,
  worksheetSortRoute,
  worksheetSummaryDataRoute,
} from './types.js';

const makeInstance = (baseUrl: string, token = 'valid-token'): ExternalApiInstance => ({
  baseUrl,
  token,
  pid: 4321,
  instanceId: 'inst-test',
  apiVersion: '1.0',
});

const invokeBody = (
  namespace: string,
  command: string,
  parameters: Record<string, unknown> = {},
): Record<string, unknown> => ({ namespace, command, parameters });

describe('ExternalApiHttp', () => {
  let server: MockExternalApiServer;
  let http: ExternalApiHttp;

  beforeEach(async () => {
    server = await startMockExternalApiServer({ workbookXml: '<workbook><sheet /></workbook>' });
    http = new ExternalApiHttp(makeInstance(server.baseUrl));
  });

  afterEach(async () => {
    await server.close();
  });

  it('reports liveness from GET /v0/health', async () => {
    const result = await http.getOk(EXTERNAL_API_ROUTES.health);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().ok).toBe(true);
  });

  it('attaches the bearer token from the discovery file on every request', async () => {
    await http.getOk(EXTERNAL_API_ROUTES.health);
    expect(server.requests.at(-1)?.authorization).toBe('Bearer valid-token');
  });

  it('returns the workbook document XML and version headers on GET', async () => {
    const result = await http.getXml(EXTERNAL_API_ROUTES.workbookDocument);
    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.xml).toBe('<workbook><sheet /></workbook>');
    expect(value.applicationVersion).toBe('2026.1');
    expect(value.xsdPayloadVersion).toBe('2026.1.0');
  });

  it('round-trips a workbook document via POST with an XML content type', async () => {
    const xml = '<workbook><updated /></workbook>';
    const result = await http.postXmlEnvelope(EXTERNAL_API_ROUTES.workbookDocument, xml);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().state).toBe('succeeded');

    const posted = server.requests.at(-1);
    expect(posted?.method).toBe('POST');
    expect(posted?.contentType).toContain('application/xml');
    expect(posted?.body).toBe(xml);
  });

  it('maps a 400 invalid-request-body problem when applying an empty document', async () => {
    const result = await http.postXmlEnvelope(EXTERNAL_API_ROUTES.workbookDocument, '');
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error.type).toBe('problem');
    if (error.type === 'problem') {
      expect(error.status).toBe(400);
      expect(error.code).toBe('invalid-request-body');
    }
  });

  it('maps a 415 unsupported-content-type problem response', async () => {
    server.setOverride('POST /v0/workbook/document', {
      status: 415,
      body: JSON.stringify({ code: 'unsupported-content-type', title: 'unsupported-content-type' }),
    });

    const result = await http.postXmlEnvelope(EXTERNAL_API_ROUTES.workbookDocument, '<workbook />');
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    if (error.type === 'problem') {
      expect(error.status).toBe(415);
      expect(error.code).toBe('unsupported-content-type');
    } else {
      throw new Error(`expected problem error, got ${error.type}`);
    }
  });

  it('invokes a command and surfaces the operation envelope result and state', async () => {
    const result = await http.postJsonEnvelope(
      EXTERNAL_API_ROUTES.invokeCommand,
      invokeBody('tabdoc', 'undo', { steps: 1 }),
    );
    expect(result.isOk()).toBe(true);
    const envelope = result.unwrap();
    expect(envelope.state).toBe('succeeded');
    expect(envelope.result).toEqual({
      namespace: 'tabdoc',
      command: 'undo',
      echoedParameters: { steps: 1 },
    });
    expect(envelope.createdAt).toBe('2026-07-07T10:00:00Z');
    expect(envelope.completedAt).toBe('2026-07-07T10:00:01Z');
  });

  it('maps a command-not-found problem', async () => {
    const result = await http.postJsonEnvelope(
      EXTERNAL_API_ROUTES.invokeCommand,
      invokeBody('tabdoc', 'missing-command'),
    );
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    if (error.type === 'problem') {
      expect(error.status).toBe(404);
      expect(error.code).toBe('command-not-found');
    } else {
      throw new Error(`expected problem error, got ${error.type}`);
    }
  });

  it('maps an invalid-command-parameter problem', async () => {
    const result = await http.postJsonEnvelope(
      EXTERNAL_API_ROUTES.invokeCommand,
      invokeBody('tabdoc', 'bad-param', { nope: true }),
    );
    const error = result.unwrapErr();
    if (error.type === 'problem') {
      expect(error.code).toBe('invalid-command-parameter');
    } else {
      throw new Error(`expected problem error, got ${error.type}`);
    }
  });

  it('gets the API root from GET /v0/', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.root, apiRootSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      apiVersion: '0.1.0',
      applicationVersion: '2026.1',
      links: expect.objectContaining({
        health: '/v0/health',
        workbook: '/v0/workbook',
      }),
    });

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/');
  });

  it('lists worksheets from GET /v0/workbook/worksheets', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.workbookWorksheets, worksheetListSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().worksheets).toEqual([
      expect.objectContaining({ id: 'sheet-sales', name: 'Sales by Region', hidden: false }),
      expect.objectContaining({ id: 'sheet-profit', name: 'Profit by Category', hidden: false }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets');
  });

  it('polls an overflowed (202) JSON read and returns the terminal result body', async () => {
    server.setOverride('GET /v0/workbook/worksheets', {
      status: 202,
      contentType: 'application/json',
      headers: {
        location: '/v0/operations/op-ws',
        'retry-after': '0',
        'x-tableau-operation-id': 'op-ws',
      },
      body: JSON.stringify({ id: 'op-ws', kind: 'workbook.listWorksheets', state: 'RUNNING' }),
    });
    server.setOperation('op-ws', {
      retryAfterSeconds: 0,
      poll: [
        { id: 'op-ws', kind: 'workbook.listWorksheets', state: 'RUNNING' },
        {
          id: 'op-ws',
          kind: 'workbook.listWorksheets',
          state: 'SUCCEEDED',
          result: {
            worksheets: [
              { id: 'sheet-sales', name: 'Sales by Region', hidden: false, isActiveSheet: true },
            ],
          },
        },
      ],
    });

    const result = await http.getJson(EXTERNAL_API_ROUTES.workbookWorksheets, worksheetListSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().worksheets).toEqual([
      expect.objectContaining({ id: 'sheet-sales', name: 'Sales by Region' }),
    ]);
    expect(server.requests.some((r) => r.path === '/v0/operations/op-ws')).toBe(true);
  });

  it('polls an overflowed (202) XML document read and unwraps result.document', async () => {
    server.setOverride('GET /v0/workbook/document', {
      status: 202,
      contentType: 'application/json',
      headers: { location: '/v0/operations/op-doc', 'x-tableau-operation-id': 'op-doc' },
      body: JSON.stringify({ id: 'op-doc', kind: 'workbook.getDocument', state: 'RUNNING' }),
    });
    server.setOperation('op-doc', {
      retryAfterSeconds: 0,
      poll: [
        {
          id: 'op-doc',
          kind: 'workbook.getDocument',
          state: 'SUCCEEDED',
          result: { document: '<workbook version="18.1"><worksheets /></workbook>' },
        },
      ],
    });

    const result = await http.getXml(EXTERNAL_API_ROUTES.workbookDocument);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toBe('<workbook version="18.1"><worksheets /></workbook>');
    expect(server.requests.some((r) => r.path === '/v0/operations/op-doc')).toBe(true);
  });

  it('lists dashboards from GET /v0/workbook/dashboards', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.workbookDashboards, dashboardListSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().dashboards).toEqual([
      expect.objectContaining({ id: 'dash-exec', name: 'Executive Dashboard', hidden: false }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/dashboards');
  });

  it('lists storyboards from GET /v0/workbook/storyboards', async () => {
    const result = await http.getJson(
      EXTERNAL_API_ROUTES.workbookStoryboards,
      storyboardListSchema,
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().storyboards).toEqual([
      expect.objectContaining({ id: 'story-qbr', name: 'QBR Story', hidden: false }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/storyboards');
  });

  it('gets the open workbook inventory from GET /v0/workbook', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.workbook, workbookInventorySchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      title: 'Regional Sales Analysis',
      unsavedChanges: true,
      worksheets: expect.arrayContaining([
        expect.objectContaining({
          id: 'sheet-sales',
          name: 'Sales by Region',
          datasources: ['Sample - Superstore'],
        }),
      ]),
      dashboards: [expect.objectContaining({ id: 'dash-exec', name: 'Executive Dashboard' })],
      storyboards: [expect.objectContaining({ id: 'story-qbr', name: 'QBR Story' })],
    });

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook');
  });

  it('lists workbook datasources from GET /v0/workbook/datasources', async () => {
    const result = await http.getJson(
      EXTERNAL_API_ROUTES.workbookDatasources,
      datasourceListSchema,
    );

    expect(result.isOk()).toBe(true);
    // The HTTP layer passes the wire shape through verbatim: a real luid, an explicit
    // null (embedded/federated), and an absent luid (legacy build) all round-trip
    // as-is — the nullish() schema accepts string | null | undefined.
    expect(result.unwrap().datasources).toEqual([
      {
        id: 'wb-ds-superstore',
        luid: 'luid-superstore',
        name: 'Sample - Superstore',
        caption: 'Sample - Superstore',
      },
      { id: 'wb-ds-quota', luid: null, name: 'Quota Targets', caption: 'Quota Targets' },
      { id: 'wb-ds-legacy', name: 'Legacy Extract', caption: 'Legacy Extract' },
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/datasources');
  });

  it('lists published site workbooks from GET /v0/site/workbooks', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.siteWorkbooks, siteWorkbookListSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().workbooks).toEqual([
      expect.objectContaining({
        id: 'wb-regional-sales',
        luid: 'luid-regional-sales',
        name: 'Regional Sales Analysis',
      }),
      expect.objectContaining({ id: 'wb-ops-scorecard', name: 'Ops Scorecard' }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/site/workbooks');
  });

  it('gets the connected site from GET /v0/site', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.site, siteSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      siteId: 'site-sales',
      authenticatedUserId: 'user-author',
    });

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/site');
  });

  it('gets a worksheet by id from GET /v0/workbook/worksheets/{id}', async () => {
    const result = await http.getJson(worksheetRoute('sheet-sales'), worksheetItemSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual(
      expect.objectContaining({
        id: 'sheet-sales',
        name: 'Sales by Region',
        hidden: false,
        datasources: ['Sample - Superstore'],
      }),
    );

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales');
  });

  it('gets a dashboard by id from GET /v0/workbook/dashboards/{id}', async () => {
    const result = await http.getJson(dashboardRoute('dash-exec'), dashboardItemSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual(
      expect.objectContaining({
        id: 'dash-exec',
        name: 'Executive Dashboard',
        hidden: false,
        containedSheets: ['sheet-sales', 'sheet-profit'],
      }),
    );

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/dashboards/dash-exec');
  });

  it('gets a storyboard by id from GET /v0/workbook/storyboards/{id}', async () => {
    const result = await http.getJson(storyboardRoute('story-qbr'), storyboardItemSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual(
      expect.objectContaining({
        id: 'story-qbr',
        name: 'QBR Story',
        hidden: false,
        storyPointCount: 4,
      }),
    );

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/storyboards/story-qbr');
  });

  it('gets a worksheet document by id from GET /v0/workbook/worksheets/{id}/document', async () => {
    const result = await http.getXml(worksheetDocumentRoute('sheet-sales'));

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toContain('<worksheet name="Sales by Region"');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales/document');
  });

  it('gets a dashboard document by id from GET /v0/workbook/dashboards/{id}/document', async () => {
    const result = await http.getXml(dashboardDocumentRoute('dash-exec'));

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toContain('<dashboard name="Executive Dashboard"');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/dashboards/dash-exec/document');
  });

  it('gets a storyboard document by id from GET /v0/workbook/storyboards/{id}/document', async () => {
    const result = await http.getXml(storyboardDocumentRoute('story-qbr'));

    expect(result.isOk()).toBe(true);
    // A storyboard serializes as a bare `<dashboard type="storyboard">` fragment.
    expect(result.unwrap().xml).toContain('<dashboard name="QBR Story" type="storyboard"');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/storyboards/story-qbr/document');
  });

  it('gets application info from GET /v0/app', async () => {
    const result = await http.getJson(EXTERNAL_API_ROUTES.app, appInfoSchema);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({
      applicationVersion: '2026.1',
      build: '20261.26.0701.1234',
      edition: 'Professional',
      os: 'macOS',
    });

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/app');
  });

  it('gets worksheet summary data, repeating columnsToIncludeByFieldName per column', async () => {
    const route = worksheetSummaryDataRoute('sheet-sales', {
      maxRows: 25,
      ignoreAliases: true,
      ignoreSelection: true,
      columnsToIncludeByFieldName: ['Sales', 'Profit'],
    });

    const result = await http.getJson(route, summaryDataSchema, new AbortController().signal);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      columns: [
        { name: 'Region', dataType: 'string' },
        { name: 'Sales', dataType: 'real' },
        { name: 'Profit', dataType: 'real' },
      ],
      rows: [
        ['West', 1200, 240],
        ['East', 900, 120],
      ],
    });

    // The mock's searchParams map collapses repeated keys; assert the built route string
    // carries a pair per column (a field name may itself contain a comma).
    const query = new URL(route, 'http://localhost').searchParams;
    expect(query.get('maxRows')).toBe('25');
    expect(query.getAll('columnsToIncludeByFieldName')).toEqual(['Sales', 'Profit']);

    const last = server.requests.at(-1) as any;
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales/summaryData');
  });

  it('lists worksheet logical tables from GET .../logicalTables', async () => {
    const result = await http.getJson(
      worksheetLogicalTablesRoute('sheet-sales'),
      logicalTableListSchema,
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().tables).toEqual([
      { id: 'lt-orders', caption: 'Orders' },
      { id: 'lt-returns', caption: 'Returns' },
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales/logicalTables');
  });

  it('gets underlying data, repeating columnsToIncludeByFieldName per column', async () => {
    const route = worksheetLogicalTableDataRoute('sheet-sales', 'lt-orders', {
      maxRows: 25,
      includeAllColumns: true,
      columnsToIncludeByFieldName: ['Region, State', 'Sales'],
    });

    const result = await http.getJson(route, summaryDataSchema, new AbortController().signal);

    expect(result.isOk()).toBe(true);
    const query = new URL(route, 'http://localhost').searchParams;
    expect(query.get('maxRows')).toBe('25');
    expect(query.get('includeAllColumns')).toBe('true');
    expect(query.getAll('columnsToIncludeByFieldName')).toEqual(['Region, State', 'Sales']);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales/logicalTables/lt-orders/data');
  });

  it('deletes a worksheet via a bodyless POST .../{id}:delete', async () => {
    const result = await http.postEnvelope(
      sheetActionRoute({ kind: 'worksheet', id: 'sheet-sales' }, 'delete'),
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().state).toBe('succeeded');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales:delete');
    expect(last?.body).toBe('');
  });

  it('routes a dashboard delete to the dashboards :delete path', async () => {
    const result = await http.postEnvelope(
      sheetActionRoute({ kind: 'dashboard', id: 'dash-exec' }, 'delete'),
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    const last = server.requests.at(-1);
    expect(last?.path).toBe('/v0/workbook/dashboards/dash-exec:delete');
  });

  it('renames a worksheet via POST .../{id}:rename with a JSON name body', async () => {
    const result = await http.postJsonEnvelope(
      sheetActionRoute({ kind: 'worksheet', id: 'sheet-sales' }, 'rename'),
      { name: 'Regional' },
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    const last = server.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales:rename');
    expect(JSON.parse(last?.body ?? '{}')).toEqual({ name: 'Regional' });
  });

  it('sorts a worksheet via POST .../{id}:sort with the sort body', async () => {
    const result = await http.postJsonEnvelope(
      worksheetSortRoute('sheet-sales'),
      { fieldName: '[Superstore].[Sales]', direction: 'desc', sortType: 'alpha' },
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    const last = server.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales:sort');
    expect(JSON.parse(last?.body ?? '{}')).toEqual({
      fieldName: '[Superstore].[Sales]',
      direction: 'desc',
      sortType: 'alpha',
    });
  });

  it('activates a sheet via POST /v0/workbook:goToSheet with the id', async () => {
    const result = await http.postJsonEnvelope(
      EXTERNAL_API_ROUTES.workbookGoToSheet,
      { id: 'sheet-profit' },
      new AbortController().signal,
    );

    expect(result.isOk()).toBe(true);
    const last = server.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v0/workbook:goToSheet');
    expect(JSON.parse(last?.body ?? '{}')).toEqual({ id: 'sheet-profit' });
  });

  it('validates a workbook document via POST /v0/workbook/document:validate', async () => {
    const xml = '<workbook><validated /></workbook>';
    const result = await http.postXmlForBody(
      EXTERNAL_API_ROUTES.workbookDocumentValidate,
      xml,
      validationResultSchema,
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ isValid: true, validationIssues: [] });

    const last = server.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v0/workbook/document:validate');
    expect(last?.contentType).toContain('application/xml');
    expect(last?.body).toBe(xml);
  });

  it('lists published site datasources from GET /v0/site/datasources', async () => {
    const result = await http.getJson(
      EXTERNAL_API_ROUTES.siteDatasources,
      siteDatasourceListSchema,
    );

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().datasources).toEqual([
      expect.objectContaining({
        id: 'ds-superstore',
        luid: 'luid-superstore',
        name: 'Sample - Superstore',
      }),
      expect.objectContaining({ id: 'ds-quota', luid: 'luid-quota', name: 'Quota Targets' }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/site/datasources');
  });

  it('surfaces a 401 as an unauthorized error when the token is stale', async () => {
    const staleHttp = new ExternalApiHttp(makeInstance(server.baseUrl, 'stale-token'));
    const result = await staleHttp.getXml(EXTERNAL_API_ROUTES.workbookDocument);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('unauthorized');
  });

  it('surfaces a network error when the host is unreachable', async () => {
    const { baseUrl } = server;
    await server.close();
    // Reopen so afterEach close() is a no-op-safe double close is avoided.
    server = await startMockExternalApiServer();

    const deadHttp = new ExternalApiHttp(makeInstance(baseUrl));
    const result = await deadHttp.getOk(EXTERNAL_API_ROUTES.health);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('network');
  });
});
