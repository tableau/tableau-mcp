import { ExternalApiHttp } from './externalApiHttp.js';
import { ExternalApiToolExecutor } from './externalApiToolExecutor.js';
import { MockExternalApiServer, startMockExternalApiServer } from './mockExternalApiServer.js';
import {
  dashboardRoute,
  datasourceRefreshDataRoute,
  datasourceRefreshExtractRoute,
  EXTERNAL_API_ROUTES,
  ExternalApiInstance,
  sheetActionRoute,
  storyboardRoute,
  workbookDatasourceDocumentRoute,
  workbookDatasourceRoute,
  workbookDatasourceValidateCalculatedFieldRoute,
  worksheetImageRoute,
  worksheetLogicalTableDataRoute,
  worksheetRoute,
} from './types.js';

vi.mock('../../logging/logger.js');

const BASE_URL = 'http://127.0.0.1:5000';
const TOKEN = 'secret-token-123';

const instance = (baseUrl = BASE_URL, token = TOKEN): ExternalApiInstance => ({
  baseUrl,
  token,
  pid: 4321,
  instanceId: 'inst-safety',
  apiVersion: '0.2.0',
});

const acceptedWith = (location: string): Response =>
  new Response('{}', {
    status: 202,
    headers: { location, 'retry-after': '0', 'x-tableau-operation-id': 'op-1' },
  });

const succeeded = (): Response =>
  new Response(JSON.stringify({ id: 'op-1', kind: 'k', state: 'SUCCEEDED', result: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('poll Location safety', () => {
  it.each([
    '@evil.example/x',
    '//evil.example/x',
    'https://evil.example/x',
    '/v0/operations/..',
    '/v0/operations/%2e%2e',
    '/v0/operations/%252e%252e',
    '/v0/operations/a/../../app',
    '/v0/operations/op-1?x=1',
    '/v0/app',
  ])('never sends the bearer token off the discovered origin for Location %s', async (location) => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(acceptedWith(location))
      .mockResolvedValue(succeeded());
    const http = new ExternalApiHttp(instance(), { fetchFn });

    const result = await http.postEnvelope(EXTERNAL_API_ROUTES.workbookUndo);

    for (const [url] of fetchFn.mock.calls) {
      expect(new URL(String(url)).origin).toBe(BASE_URL);
    }
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().type).toBe('invalid-response');
    expect(
      JSON.stringify(result.unwrapErr(), Object.getOwnPropertyNames(result.unwrapErr())),
    ).not.toContain(TOKEN);
  });

  it('still polls a well-formed /v0/operations/<id> Location', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(acceptedWith('/v0/operations/op-1'))
      .mockResolvedValue(succeeded());
    const http = new ExternalApiHttp(instance(), { fetchFn });

    const result = await http.postEnvelope(EXTERNAL_API_ROUTES.workbookUndo);

    expect(result.isOk()).toBe(true);
    expect(fetchFn.mock.calls[1][0]).toBe(`${BASE_URL}/v0/operations/op-1`);
  });
});

describe('request route safety', () => {
  it.each([
    '@evil.example/x',
    '//evil.example/x',
    'https://evil.example/x',
    'v0/health',
    '/../app',
  ])('refuses route %s without calling fetch', async (route) => {
    const fetchFn = vi.fn();
    const http = new ExternalApiHttp(instance(), { fetchFn });

    const result = await http.getOk(route);

    expect(result.unwrapErr().type).toBe('invalid-response');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps a route with an encoded query suffix on the discovered origin', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const http = new ExternalApiHttp(instance(), { fetchFn });
    const route = worksheetImageRoute('sheet-1', { filePath: "/tmp/it's here.png" });

    const result = await http.getOk(route);

    expect(result.isOk()).toBe(true);
    expect(new URL(String(fetchFn.mock.calls[0][0])).pathname).toBe(
      '/v0/workbook/worksheets/sheet-1/image',
    );
  });
});

describe('poll timing', () => {
  it('caps an oversized Retry-After and never sleeps past the poll deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('{}', {
            status: 202,
            headers: { location: '/v0/operations/op-1', 'retry-after': '86400' },
          }),
        )
        .mockResolvedValue(succeeded());
      const http = new ExternalApiHttp(instance(), { fetchFn, pollDeadlineMs: 2_000 });

      const pending = http.postEnvelope(EXTERNAL_API_ROUTES.workbookUndo);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await pending;

      expect(result.isOk()).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a network Err flagged aborted when the signal fires during the poll delay', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      new Response('{}', {
        status: 202,
        headers: { location: '/v0/operations/op-1', 'retry-after': '30' },
      }),
    );
    const http = new ExternalApiHttp(instance(), { fetchFn });
    const controller = new AbortController();

    const pending = http.postEnvelope(EXTERNAL_API_ROUTES.workbookUndo, controller.signal);
    setTimeout(() => controller.abort(new Error('cancelled')), 20);
    const result = await pending;

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toMatchObject({ type: 'network', aborted: true });
  });
});

describe('401 while polling', () => {
  it('maps a POST poll 401 to accepted-unauthorized, not unauthorized', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(acceptedWith('/v0/operations/op-1'))
      .mockResolvedValue(new Response(null, { status: 401 }));
    const http = new ExternalApiHttp(instance(), { fetchFn });

    const result = await http.postEnvelope(EXTERNAL_API_ROUTES.workbookUndo);

    expect(result.unwrapErr()).toEqual({ type: 'accepted-unauthorized', operationId: 'op-1' });
  });

  it('keeps unauthorized for a GET poll so the executor may rescan and redo it', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(acceptedWith('/v0/operations/op-1'))
      .mockResolvedValue(new Response(null, { status: 401 }));
    const http = new ExternalApiHttp(instance(), { fetchFn });

    const result = await http.getXml(EXTERNAL_API_ROUTES.workbookDocument);

    expect(result.unwrapErr().type).toBe('unauthorized');
  });
});

describe('route builders refuse unsafe ids', () => {
  const unsafe = ['\uD800', '..', '.', '%2e%2e', '%252e%252e', '%2E%2E', 'a\u0000b', 'a\nb'];
  const builders: Array<[string, (id: string) => string]> = [
    ['worksheetRoute', worksheetRoute],
    ['dashboardRoute', dashboardRoute],
    ['storyboardRoute', storyboardRoute],
    ['workbookDatasourceRoute', workbookDatasourceRoute],
    ['workbookDatasourceDocumentRoute', workbookDatasourceDocumentRoute],
    [
      'workbookDatasourceValidateCalculatedFieldRoute',
      workbookDatasourceValidateCalculatedFieldRoute,
    ],
    ['datasourceRefreshDataRoute', datasourceRefreshDataRoute],
    ['datasourceRefreshExtractRoute', datasourceRefreshExtractRoute],
    ['sheetActionRoute', (id) => sheetActionRoute({ kind: 'worksheet', id }, 'delete')],
    ['worksheetLogicalTableDataRoute', (id) => worksheetLogicalTableDataRoute('s1', id, {})],
  ];

  it.each(
    builders.flatMap(([name, build]) =>
      unsafe.map((id) => [name, JSON.stringify(id), build] as const),
    ),
  )('%s throws for %s', (_name, id, build) => {
    expect(() => build(JSON.parse(id))).toThrow(/unsafe|malformed/);
  });

  it('throws on a malformed percent escape in a datasource id instead of a URIError', () => {
    expect(() => workbookDatasourceRoute('100%')).toThrow(/malformed/);
  });

  it.each([
    ['a/b', 'a%2Fb'],
    ['a%2Fb', 'a%252Fb'],
    ['100%', '100%25'],
  ])('keeps slash-bearing id %s inside one segment', (id, segment) => {
    expect(worksheetRoute(id)).toBe(`/v0/workbook/worksheets/${segment}`);
  });
});

describe('executor sends nothing for an unsafe id', () => {
  let server: MockExternalApiServer;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it.each(['..', '%2e%2e', '%252e%252e', '\uD800'])(
    'returns invalid-response and sends no request for worksheet id %s',
    async (id) => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [instance(server.baseUrl, 'valid-token')],
      });
      await executor.start();
      const before = server.requests.length;

      const read = await executor.getWorksheetDocument(id, signal);
      const write = await executor.deleteSheet({ kind: 'worksheet', id }, signal);

      expect(read.unwrapErr().type).toBe('invalid-response');
      expect(write.unwrapErr().type).toBe('invalid-response');
      expect(server.requests.length).toBe(before);
    },
  );

  it.each(['..', '%2e%2e', '%252e%252e', 'a\u0000b'])(
    'sends no request for datasource id %s',
    async (id) => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [instance(server.baseUrl, 'valid-token')],
      });
      await executor.start();
      const before = server.requests.length;

      const data = await executor.refreshDatasourceData(id, signal);
      const extract = await executor.refreshDatasourceExtract(id, {}, signal);
      const validate = await executor.validateDatasourceCalculatedField(
        id,
        { formula: '1' },
        signal,
      );

      expect(data.isErr()).toBe(true);
      expect(extract.isErr()).toBe(true);
      expect(validate.isErr()).toBe(true);
      expect(server.requests.length).toBe(before);
    },
  );

  it('sends an already-encoded datasource id to the refresh routes without re-encoding it', async () => {
    const executor = new ExternalApiToolExecutor({
      discover: () => [instance(server.baseUrl, 'valid-token')],
    });
    await executor.start();

    await executor.refreshDatasourceData('My%20Data', signal);
    await executor.refreshDatasourceExtract('My%20Data', {}, signal);

    const posts = server.requests.filter((r) => r.method === 'POST').map((r) => r.path);
    expect(posts).toContain('/v0/datasources/My%20Data:refreshData');
    expect(posts).toContain('/v0/datasources/My%20Data:refreshExtract');
  });

  it('sends the delete POST exactly once when the poll returns 401', async () => {
    const discover = vi.fn(() => [instance(server.baseUrl, 'valid-token')]);
    server.setOverride('POST /v0/workbook/worksheets/sheet-1:delete', {
      status: 202,
      contentType: 'application/json',
      headers: {
        location: '/v0/operations/op-del',
        'retry-after': '0',
        'x-tableau-operation-id': 'op-del',
      },
      body: JSON.stringify({ id: 'op-del', kind: 'k', state: 'RUNNING' }),
    });
    server.setOverride('GET /v0/operations/op-del', { status: 401 });
    const executor = new ExternalApiToolExecutor({ discover });
    await executor.start();

    const result = await executor.deleteSheet({ kind: 'worksheet', id: 'sheet-1' }, signal);

    const error = result.unwrapErr();
    expect(error.type).toBe('unknown');
    expect(String((error as { error: unknown }).error)).toMatch(/accepted.*result is unknown/s);
    expect(String((error as { error: unknown }).error)).toContain('op-del');
    expect(
      server.requests.filter(
        (r) => r.method === 'POST' && r.path === '/v0/workbook/worksheets/sheet-1:delete',
      ),
    ).toHaveLength(1);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('keeps Desktop warnings and diagnostics on a failed command', async () => {
    server.setOverride('POST /v0/workbook:undo', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'op-f',
        kind: 'k',
        state: 'FAILED',
        error: { code: 'boom', message: 'it broke' },
        warnings: [{ code: 'w1', message: 'careful' }],
      }),
    });
    const executor = new ExternalApiToolExecutor({
      discover: () => [instance(server.baseUrl, 'valid-token')],
    });
    await executor.start();

    const result = await executor.undo(signal);

    expect(result.unwrapErr()).toMatchObject({
      type: 'command-failed',
      warnings: [{ code: 'w1', message: 'careful' }],
    });
  });
});
