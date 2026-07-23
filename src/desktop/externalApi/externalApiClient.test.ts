import { ExternalApiClient } from './externalApiClient.js';
import { MockExternalApiServer, startMockExternalApiServer } from './mockExternalApiServer.js';
import { ExternalApiInstance } from './types.js';

const makeInstance = (baseUrl: string, token = 'valid-token'): ExternalApiInstance => ({
  baseUrl,
  token,
  pid: 4321,
  instanceId: 'inst-test',
  apiVersion: '1.0',
});

describe('ExternalApiClient', () => {
  let server: MockExternalApiServer;
  let client: ExternalApiClient;

  beforeEach(async () => {
    server = await startMockExternalApiServer({ workbookXml: '<workbook><sheet /></workbook>' });
    client = new ExternalApiClient(makeInstance(server.baseUrl));
  });

  afterEach(async () => {
    await server.close();
  });

  it('reports liveness from GET /v0/health', async () => {
    const result = await client.health();
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().healthy).toBe(true);
  });

  it('attaches the bearer token from the discovery file on every request', async () => {
    await client.health();
    expect(server.requests.at(-1)?.authorization).toBe('Bearer valid-token');
  });

  it('returns the workbook document XML and version headers on GET', async () => {
    const result = await client.getWorkbookDocument();
    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.xml).toBe('<workbook><sheet /></workbook>');
    expect(value.applicationVersion).toBe('2026.1');
    expect(value.xsdPayloadVersion).toBe('2026.1.0');
  });

  it('round-trips a workbook document via POST with an XML content type', async () => {
    const xml = '<workbook><updated /></workbook>';
    const result = await client.applyWorkbookDocument(xml);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().state).toBe('succeeded');

    const posted = server.requests.at(-1);
    expect(posted?.method).toBe('POST');
    expect(posted?.contentType).toContain('application/xml');
    expect(posted?.body).toBe(xml);
  });

  it('maps a 400 invalid-request-body problem when applying an empty document', async () => {
    const result = await client.applyWorkbookDocument('');
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

    const result = await client.applyWorkbookDocument('<workbook />');
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
    const result = await client.invokeCommand('tabdoc', 'undo', { steps: 1 });
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
    const result = await client.invokeCommand('tabdoc', 'missing-command', {});
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
    const result = await client.invokeCommand('tabdoc', 'bad-param', { nope: true });
    const error = result.unwrapErr();
    if (error.type === 'problem') {
      expect(error.code).toBe('invalid-command-parameter');
    } else {
      throw new Error(`expected problem error, got ${error.type}`);
    }
  });

  it('fetches the machine-readable openapi schema', async () => {
    const result = await client.fetchOpenApi();
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({ openapi: '3.1.0' });
  });

  it('gets the API root from GET /v0/', async () => {
    const result = await client.getRoot();

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
    const result = await client.listWorksheets();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().worksheets).toEqual([
      expect.objectContaining({ id: 'sheet-sales', name: 'Sales by Region', hidden: false }),
      expect.objectContaining({ id: 'sheet-profit', name: 'Profit by Category', hidden: false }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets');
  });

  it('lists dashboards from GET /v0/workbook/dashboards', async () => {
    const result = await client.listDashboards();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().dashboards).toEqual([
      expect.objectContaining({ id: 'dash-exec', name: 'Executive Dashboard', hidden: false }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/dashboards');
  });

  it('lists storyboards from GET /v0/workbook/storyboards', async () => {
    const result = await client.listStoryboards();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().storyboards).toEqual([
      expect.objectContaining({ id: 'story-qbr', name: 'QBR Story', hidden: false }),
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/storyboards');
  });

  it('gets the open workbook inventory from GET /v0/workbook', async () => {
    const result = await client.getWorkbook();

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
    const result = await client.listWorkbookDatasources();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().datasources).toEqual([
      {
        id: 'wb-ds-superstore',
        luid: 'luid-superstore',
        name: 'Sample - Superstore',
        caption: 'Sample - Superstore',
      },
      { id: 'wb-ds-quota', luid: null, name: 'Quota Targets', caption: 'Quota Targets' },
    ]);

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/datasources');
  });

  it('lists published site workbooks from GET /v0/site/workbooks', async () => {
    const result = await client.listSiteWorkbooks();

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
    const result = await client.getSite();

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
    const result = await client.getWorksheet('sheet-sales');

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
    const result = await client.getDashboard('dash-exec');

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
    const result = await client.getStoryboard('story-qbr');

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
    const result = await client.getWorksheetDocument('sheet-sales');

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toContain('<worksheet name="Sales by Region"');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales/document');
  });

  it('gets a dashboard document by id from GET /v0/workbook/dashboards/{id}/document', async () => {
    const result = await client.getDashboardDocument('dash-exec');

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toContain('<dashboard name="Executive Dashboard"');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/dashboards/dash-exec/document');
  });

  it('gets a storyboard document by id from GET /v0/workbook/storyboards/{id}/document', async () => {
    const result = await client.getStoryboardDocument('story-qbr');

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toContain('<storyboard name="QBR Story"');

    const last = server.requests.at(-1);
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/storyboards/story-qbr/document');
  });

  it('gets application info from GET /v0/app', async () => {
    const result = await client.getApp();

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

  it('gets worksheet summary data with query parameters', async () => {
    const result = await client.getWorksheetSummaryData(
      'sheet-sales',
      {
        maxRows: 25,
        ignoreAliases: true,
        ignoreSelection: true,
        columnsToIncludeByFieldName: 'Sales,Profit',
      },
      new AbortController().signal,
    );

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

    const last = server.requests.at(-1) as any;
    expect(last?.method).toBe('GET');
    expect(last?.path).toBe('/v0/workbook/worksheets/sheet-sales/summaryData');
    expect(last?.searchParams).toEqual({
      maxRows: '25',
      ignoreAliases: 'true',
      ignoreSelection: 'true',
      columnsToIncludeByFieldName: 'Sales,Profit',
    });
  });

  it('validates a workbook document via POST /v0/workbook/document:validate', async () => {
    const xml = '<workbook><validated /></workbook>';
    const result = await client.validateWorkbookDocument(xml);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ isValid: true, validationIssues: [] });

    const last = server.requests.at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.path).toBe('/v0/workbook/document:validate');
    expect(last?.contentType).toContain('application/xml');
    expect(last?.body).toBe(xml);
  });

  it('lists published site datasources from GET /v0/site/datasources', async () => {
    const result = await client.listSiteDatasources();

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
    const staleClient = new ExternalApiClient(makeInstance(server.baseUrl, 'stale-token'));
    const result = await staleClient.getWorkbookDocument();
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('unauthorized');
  });

  it('surfaces a network error when the host is unreachable', async () => {
    const { baseUrl } = server;
    await server.close();
    // Reopen so afterEach close() is a no-op-safe double close is avoided.
    server = await startMockExternalApiServer();

    const deadClient = new ExternalApiClient(makeInstance(baseUrl));
    const result = await deadClient.health();
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('network');
  });
});
