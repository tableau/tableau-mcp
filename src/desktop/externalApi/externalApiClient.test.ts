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

  it('lists worksheets from GET /v0/workbook/worksheets', async () => {
    const result = await client.listWorksheets();
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().worksheets).toEqual([
      { id: 'w1', name: 'Sheet 1', hidden: false },
      { id: 'w2', name: 'Sales', hidden: false },
    ]);
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets');
  });

  it('lists dashboards from GET /v0/workbook/dashboards', async () => {
    const result = await client.listDashboards();
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().dashboards).toEqual([
      { id: 'd1', name: 'Sales Dashboard', hidden: false },
    ]);
  });

  it('gets a worksheet document by id with version headers', async () => {
    const result = await client.getWorksheetDocument('w1');
    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.xml).toContain("<worksheet name='w1'>");
    expect(value.applicationVersion).toBe('2026.1');
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/w1/document');
  });

  it('gets a dashboard document by id', async () => {
    const result = await client.getDashboardDocument('d1');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toContain("<dashboard name='d1'>");
  });

  it('maps a sheet-not-found problem for an unknown worksheet id', async () => {
    const result = await client.getWorksheetDocument('nope');
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    if (error.type === 'problem') {
      expect(error.status).toBe(404);
      expect(error.code).toBe('sheet-not-found');
    } else {
      throw new Error(`expected problem error, got ${error.type}`);
    }
  });

  it('gets worksheet summary data and forwards query options', async () => {
    const result = await client.getWorksheetSummaryData('w1', { maxRows: 10, ignoreAliases: true });
    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.columns).toHaveLength(2);
    expect(value.rows).toEqual([
      ['Furniture', 1000],
      ['Technology', 2000],
    ]);

    const requested = server.requests.at(-1);
    expect(requested?.path).toBe('/v0/workbook/worksheets/w1/summaryData');
  });

  it('gets a worksheet item by id', async () => {
    const result = await client.getWorksheet('w1');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({ id: 'w1', name: 'Sheet 1', hidden: false });
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/w1');
  });

  it('gets a dashboard item by id', async () => {
    const result = await client.getDashboard('d1');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({ id: 'd1', name: 'Sales Dashboard' });
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards/d1');
  });

  it('lists storyboards, gets one by id, and gets its document', async () => {
    const list = await client.listStoryboards();
    expect(list.isOk()).toBe(true);
    expect(list.unwrap().storyboards).toEqual([{ id: 's1', name: 'Story 1', hidden: false }]);

    const item = await client.getStoryboard('s1');
    expect(item.isOk()).toBe(true);
    expect(item.unwrap()).toMatchObject({ id: 's1', storyPointCount: 3 });

    const doc = await client.getStoryboardDocument('s1');
    expect(doc.isOk()).toBe(true);
    expect(doc.unwrap().xml).toContain("<story name='s1'>");
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/storyboards/s1/document');
  });

  it('gets the workbook inventory', async () => {
    const result = await client.getWorkbookInventory();
    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.title).toBe('Book1');
    expect(value.unsavedChanges).toBe(true);
    expect(value.worksheets?.[0]).toMatchObject({ id: 'w1' });
  });

  it('lists workbook datasources', async () => {
    const result = await client.listWorkbookDatasources();
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().datasources[0]).toMatchObject({ name: 'Sample - Superstore' });
  });

  it('gets the connected site', async () => {
    const result = await client.getSite();
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toMatchObject({ siteId: 'site-1', authenticatedUserId: 'user-1' });
  });

  it('lists site datasources and workbooks', async () => {
    const ds = await client.listSiteDatasources();
    expect(ds.isOk()).toBe(true);
    expect(ds.unwrap().datasources[0]).toMatchObject({ name: 'Published DS' });

    const wb = await client.listSiteWorkbooks();
    expect(wb.isOk()).toBe(true);
    expect(wb.unwrap().workbooks[0]).toMatchObject({ name: 'Published WB' });
  });

  it('validates a workbook document', async () => {
    const ok = await client.validateWorkbookDocument('<workbook />');
    expect(ok.isOk()).toBe(true);
    expect(ok.unwrap().isValid).toBe(true);

    const bad = await client.validateWorkbookDocument('<not-a-workbook />');
    expect(bad.isOk()).toBe(true);
    const value = bad.unwrap();
    expect(value.isValid).toBe(false);
    expect(value.validationIssues).toHaveLength(1);

    const posted = server.requests.at(-1);
    expect(posted?.method).toBe('POST');
    expect(posted?.path).toBe('/v0/workbook/document:validate');
  });

  it('maps a sheet-not-found problem for an unknown storyboard id', async () => {
    const result = await client.getStoryboard('nope');
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    if (error.type === 'problem') {
      expect(error.status).toBe(404);
      expect(error.code).toBe('sheet-not-found');
    } else {
      throw new Error(`expected problem error, got ${error.type}`);
    }
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
