import { ExternalApiClient } from './externalApiClient.js';
import {
  MockExternalApiServer,
  MockOverride,
  startMockExternalApiServer,
} from './mockExternalApiServer.js';
import { ExternalApiInstance } from './types.js';

const makeInstance = (baseUrl: string, token = 'valid-token'): ExternalApiInstance => ({
  baseUrl,
  token,
  pid: 4321,
  instanceId: 'inst-async',
  apiVersion: '0.2.0',
});

const accepted202 = (operationId: string): MockOverride => ({
  status: 202,
  contentType: 'application/json',
  headers: {
    location: `/v0/operations/${operationId}`,
    'retry-after': '0',
    'x-tableau-operation-id': operationId,
  },
  body: JSON.stringify({ id: operationId, kind: 'command.invoke', state: 'RUNNING' }),
});

describe('ExternalApiClient async dispatch (0.2.0)', () => {
  let server: MockExternalApiServer;
  let client: ExternalApiClient;

  beforeEach(async () => {
    server = await startMockExternalApiServer();
    client = new ExternalApiClient(makeInstance(server.baseUrl));
  });

  afterEach(async () => {
    await server.close();
  });

  describe('write / invokeCommand path', () => {
    it('polls a 202 invokeCommand to a terminal SUCCEEDED and unwraps its result', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-invoke-1'));
      server.setOperation('op-invoke-1', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-invoke-1', kind: 'tabdoc:sort', state: 'RUNNING' },
          {
            id: 'op-invoke-1',
            kind: 'tabdoc:sort',
            state: 'SUCCEEDED',
            createdAt: '2026-07-30T10:00:00Z',
            updatedAt: '2026-07-30T10:00:02Z',
            completedAt: '2026-07-30T10:00:02Z',
            result: { sorted: true },
          },
        ],
      });

      const result = await client.invokeCommand('tabdoc', 'sort', {});
      expect(result.isOk()).toBe(true);
      const envelope = result.unwrap();
      expect(envelope.state).toBe('SUCCEEDED');
      expect(envelope.result).toEqual({ sorted: true });

      const polls = server.requests.filter((r) => r.path === '/v0/operations/op-invoke-1');
      expect(polls.length).toBeGreaterThanOrEqual(2);
    });

    it('polls a 202 workbook-document apply to a terminal SUCCEEDED', async () => {
      server.setOverride('POST /v0/workbook/document', accepted202('op-apply-1'));
      server.setOperation('op-apply-1', {
        poll: [{ id: 'op-apply-1', kind: 'workbook.applyDocument', state: 'SUCCEEDED' }],
      });

      const result = await client.applyWorkbookDocument('<workbook />');
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().state).toBe('SUCCEEDED');
    });

    it('surfaces a terminal FAILED operation as an envelope the executor can classify', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-fail-1'));
      server.setOperation('op-fail-1', {
        poll: [
          {
            id: 'op-fail-1',
            kind: 'tabdoc:sort',
            state: 'FAILED',
            error: { code: 'operation-failed', message: 'nope' },
          },
        ],
      });

      const result = await client.invokeCommand('tabdoc', 'sort', {});
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().state).toBe('FAILED');
    });

    it('returns awaiting-user when a poll reaches AWAITING_USER', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-user-1'));
      server.setOperation('op-user-1', {
        poll: [{ id: 'op-user-1', kind: 'tabui:open-bookmark', state: 'AWAITING_USER' }],
      });

      const result = await client.invokeCommand('tabui', 'open-bookmark', {});
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().type).toBe('awaiting-user');
    });

    it('returns operation-expired when the polled operation 404s', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-gone-1'));
      // No setOperation → the poll route 404s operation-not-found.

      const result = await client.invokeCommand('tabdoc', 'sort', {});
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().type).toBe('operation-expired');
    });

    it('does exactly one request when the command completes in-window (no spurious poll)', async () => {
      const result = await client.invokeCommand('tabdoc', 'undo', {});
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().state).toBe('succeeded');
      expect(server.requests.filter((r) => r.path.startsWith('/v0/operations')).length).toBe(0);
    });

    it('waits the Retry-After interval between polls', async () => {
      server.setOverride('POST /v0/app:invokeCommand', {
        status: 202,
        contentType: 'application/json',
        headers: {
          location: '/v0/operations/op-slow',
          'retry-after': '1',
          'x-tableau-operation-id': 'op-slow',
        },
        body: JSON.stringify({ id: 'op-slow', kind: 'tabdoc:sort', state: 'RUNNING' }),
      });
      server.setOperation('op-slow', {
        poll: [{ id: 'op-slow', kind: 'tabdoc:sort', state: 'SUCCEEDED' }],
      });

      const start = Date.now();
      const result = await client.invokeCommand('tabdoc', 'sort', {});
      const elapsed = Date.now() - start;

      expect(result.isOk()).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(900);
    });
  });

  describe('typed read path', () => {
    // A document read polled to terminal carries its XML under result.document (a JSON string).
    it('polls a workbook-document read to its terminal result.document (never JSON-as-XML)', async () => {
      server.setOverride('GET /v0/workbook/document', accepted202('op-read-1'));
      server.setOperation('op-read-1', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-read-1', kind: 'workbook.getDocument', state: 'RUNNING' },
          {
            id: 'op-read-1',
            kind: 'workbook.getDocument',
            state: 'SUCCEEDED',
            result: { document: '<workbook version="18.1"><worksheets /></workbook>' },
          },
        ],
      });

      const result = await client.getWorkbookDocument();
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().xml).toBe('<workbook version="18.1"><worksheets /></workbook>');
      expect(server.requests.some((r) => r.path === '/v0/operations/op-read-1')).toBe(true);
    });

    // JSON reads DO poll: the terminal operation's `result` carries the body the 200 would have.
    it('polls an overflowed JSON read to its terminal result (never silent-empty)', async () => {
      server.setOverride('GET /v0/workbook/worksheets', accepted202('op-read-2'));
      server.setOperation('op-read-2', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-read-2', kind: 'workbook.listWorksheets', state: 'RUNNING' },
          {
            id: 'op-read-2',
            kind: 'workbook.listWorksheets',
            state: 'SUCCEEDED',
            result: { worksheets: [{ id: 'sheet-sales', name: 'Sales by Region', hidden: false }] },
          },
        ],
      });

      const result = await client.listWorksheets();
      expect(result.isOk()).toBe(true);
      expect(result.unwrap().worksheets).toEqual([
        expect.objectContaining({ id: 'sheet-sales', name: 'Sales by Region' }),
      ]);
      expect(server.requests.some((r) => r.path === '/v0/operations/op-read-2')).toBe(true);
    });

    it('returns operation-pending on a 503 (precursor read overflow)', async () => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 503,
        contentType: 'application/problem+json',
        headers: { 'retry-after': '2' },
        body: JSON.stringify({ code: 'operation-pending', status: 503, instance: '/v0/x' }),
      });

      const result = await client.getWorksheetSummaryData('sheet-sales');
      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('operation-pending');
      if (error.type === 'operation-pending') {
        expect(error.retryAfterSeconds).toBe(2);
      }
    });

    it('surfaces a genuine service-unavailable 503 as its real Problem, not operation-pending', async () => {
      server.setOverride('GET /v0/workbook/worksheets', {
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({ code: 'api-disabled', status: 503, title: 'API disabled' }),
      });

      const result = await client.listWorksheets();
      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('problem');
      if (error.type === 'problem') {
        expect(error.status).toBe(503);
        expect(error.code).toBe('api-disabled');
      }
    });
  });
});
