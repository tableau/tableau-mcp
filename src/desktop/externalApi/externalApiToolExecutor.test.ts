import { Err, Ok } from 'ts-results-es';

import * as logger from '../../logging/logger.js';
import type { ExternalApiHttp as ExternalApiClient } from './externalApiHttp.js';
import { ExternalApiToolExecutor } from './externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  MockOverride,
  startMockExternalApiServer,
} from './mockExternalApiServer.js';
import { ExternalApiInstance } from './types.js';

vi.mock('../../logging/logger.js');

const instanceFor = (
  server: MockExternalApiServer,
  token = 'valid-token',
  apiVersion = '0.1.1',
): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token,
  pid: 999,
  instanceId: 'inst-exec',
  apiVersion,
});

describe('ExternalApiToolExecutor', () => {
  let server: MockExternalApiServer;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer({
      workbookXml: '<workbook><from-desktop /></workbook>',
    });
  });

  afterEach(async () => {
    await server.close();
  });

  describe('lifecycle', () => {
    it('logs the active External Client API transport on start', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const messages = vi.mocked(logger.log).mock.calls.map((c) => c[0].message);
      expect(messages.some((m) => m.includes('External Client API'))).toBe(true);
    });

    it('is available when a live instance is discovered', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();
      expect(executor.isAvailable()).toBe(true);
    });

    it('exposes the active Desktop instance ID', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      expect(executor.desktopInstanceId).toBeUndefined();

      await executor.start();
      expect(executor.desktopInstanceId).toBe('inst-exec');

      executor.stop();
      expect(executor.desktopInstanceId).toBeUndefined();
    });

    it('is not available when no instance is discovered', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [] });
      await executor.start();
      expect(executor.isAvailable()).toBe(false);
    });

    it('fails closed with a pid-named error when a pinned pid is not among the discovered instances', async () => {
      const executor = new ExternalApiToolExecutor({
        pid: 12345,
        discover: () => [instanceFor(server)], // pid 999 — not the pinned 12345
      });
      await executor.start();
      expect(executor.isAvailable()).toBe(false);

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('unknown');
      if (error.type === 'unknown') {
        expect(String(error.error)).toContain('PID 12345');
        expect(String(error.error)).toContain('Call list-instances');
      }
    });

    it('connects to the pinned instance when its pid is present', async () => {
      const executor = new ExternalApiToolExecutor({
        pid: 999,
        discover: () => [instanceFor(server)],
      });
      await executor.start();
      expect(executor.isAvailable()).toBe(true);
    });
  });

  describe('workbook document routing', () => {
    it('reads the workbook document with GET /v0/workbook/document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().xml).toBe('<workbook><from-desktop /></workbook>');

      const last = server.requests.at(-1);
      expect(last?.method).toBe('GET');
      expect(last?.path).toBe('/v0/workbook/document');
    });

    it('applies the workbook document with POST /v0/workbook/document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const xml = '<workbook><applied /></workbook>';
      const result = await executor.applyWorkbookDocument(xml, signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe('completed');

      const last = server.requests.at(-1);
      expect(last?.method).toBe('POST');
      expect(last?.path).toBe('/v0/workbook/document');
      expect(last?.body).toBe(xml);
    });

    it('rejects a different expected instance before the workbook POST', async () => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [{ ...instanceFor(server), instanceId: 'inst-new' }],
      });
      await executor.start();
      const onDispatch = vi.fn();

      const result = await executor.applyWorkbookDocument('<workbook />', signal, {
        expectedInstanceId: 'inst-old',
        onDispatch,
      });

      expect(result.isErr()).toBe(true);
      expect(onDispatch).not.toHaveBeenCalled();
      expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
    });

    it('reports the instance that served a successful workbook read', async () => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [{ ...instanceFor(server), instanceId: 'inst-read' }],
      });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.unwrap().instanceId).toBe('inst-read');
    });
  });

  describe('executeCommand routing', () => {
    it('routes any other command to POST /v0/app:invokeCommand', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        args: { steps: 1 },
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe('completed');
      expect(result.unwrap().result).toMatchObject({ namespace: 'tabdoc', command: 'undo' });

      const last = server.requests.at(-1);
      expect(last?.method).toBe('POST');
      expect(last?.path).toBe('/v0/app:invokeCommand');
    });

    it('maps a failed operation envelope to a command-failed error', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'fail-op',
        signal,
      });

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('command-failed');
      if (error.type === 'command-failed') {
        expect(error.error?.code).toBe('operation-failed');
      }
    });

    it('carries Operation warnings from a succeeded invokeCommand envelope', async () => {
      server.setOverride('POST /v0/app:invokeCommand', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-warn-1',
          kind: 'command.invoke',
          state: 'SUCCEEDED',
          result: { ok: true },
          warnings: [
            {
              code: 'output-serialization-failed',
              message: 'Command output could not be serialized.',
            },
          ],
        }),
      });
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().warnings).toEqual([
        {
          code: 'output-serialization-failed',
          message: 'Command output could not be serialized.',
        },
      ]);
    });

    it('preserves failed Operation message and tableau-error-code extension', async () => {
      server.setOverride('POST /v0/app:invokeCommand', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-fail-1',
          kind: 'command.invoke',
          state: 'FAILED',
          error: {
            code: 'operation-failed',
            message: 'Desktop reported the real failure',
            'tableau-error-code': '0x1234',
          },
        }),
      });
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('command-failed');
      if (error.type === 'command-failed') {
        expect(error.error?.message).toBe('Desktop reported the real failure');
        expect((error.error as Record<string, unknown>)['tableau-error-code']).toBe('0x1234');
      }
    });

    it('treats missing result on a 0.1.0 succeeded invokeCommand as silent success', async () => {
      server.setOverride('POST /v0/app:invokeCommand', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-010-1',
          kind: 'command.invoke',
          state: 'SUCCEEDED',
        }),
      });
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server, 'valid-token', '0.1.0')],
      });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().result).toBeUndefined();
      expect(result.unwrap().warnings).toBeUndefined();
    });

    it('maps a command-not-found problem to a command-failed error', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'missing-command',
        signal,
      });

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      if (error.type === 'command-failed') {
        expect(error.error?.code).toBe('command-not-found');
      } else {
        throw new Error(`expected command-failed, got ${error.type}`);
      }
    });

    it('returns an error when no instance is available', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().type).toBe('unknown');
    });
  });

  describe('first-class read endpoints', () => {
    it('gets the API root', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getRoot(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().links?.workbook).toBe('/v0/workbook');
      expect(server.requests.at(-1)?.path).toBe('/v0/');
    });

    it('checks liveness', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.health(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().healthy).toBe(true);
      expect(server.requests.at(-1)?.path).toBe('/v0/health');
    });

    it('gets the workbook inventory', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getWorkbook(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().title).toBe('Regional Sales Analysis');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook');
    });

    it('lists workbook datasources', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.listWorkbookDatasources(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().datasources?.[0]?.id).toBe('wb-ds-superstore');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/datasources');
    });

    it('lists published site workbooks', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.listSiteWorkbooks(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().workbooks?.[0]?.luid).toBe('luid-regional-sales');
      expect(server.requests.at(-1)?.path).toBe('/v0/site/workbooks');
    });

    it('gets the connected site', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getSite(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().siteId).toBe('site-sales');
      expect(server.requests.at(-1)?.path).toBe('/v0/site');
    });

    it('gets a worksheet item by id', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getWorksheet('sheet-sales', signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().datasources).toEqual(['Sample - Superstore']);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/sheet-sales');
    });

    it('gets a dashboard item by id', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getDashboard('dash-exec', signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().containedSheets).toEqual(['sheet-sales', 'sheet-profit']);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards/dash-exec');
    });

    it('gets a storyboard item by id', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getStoryboard('story-qbr', signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().storyPointCount).toBe(4);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/storyboards/story-qbr');
    });

    it.each([
      {
        label: 'pauses worksheet auto-updates',
        call: (executor: ExternalApiToolExecutor) =>
          executor.pauseWorksheetAutoUpdates('sheet-sales', signal),
        path: '/v0/workbook/worksheets/sheet-sales:pauseAutoUpdates',
      },
      {
        label: 'resumes worksheet auto-updates',
        call: (executor: ExternalApiToolExecutor) =>
          executor.resumeWorksheetAutoUpdates('sheet-sales', signal),
        path: '/v0/workbook/worksheets/sheet-sales:resumeAutoUpdates',
      },
      {
        label: 'pauses dashboard auto-updates',
        call: (executor: ExternalApiToolExecutor) =>
          executor.pauseDashboardAutoUpdates('dash-exec', signal),
        path: '/v0/workbook/dashboards/dash-exec:pauseAutoUpdates',
      },
      {
        label: 'resumes dashboard auto-updates',
        call: (executor: ExternalApiToolExecutor) =>
          executor.resumeDashboardAutoUpdates('dash-exec', signal),
        path: '/v0/workbook/dashboards/dash-exec:resumeAutoUpdates',
      },
    ])('$label via a bodyless POST to the per-sheet action route', async ({ call, path }) => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await call(executor);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe('completed');
      const last = server.requests.at(-1);
      expect(last?.method).toBe('POST');
      expect(last?.path).toBe(path);
      expect(last?.body).toBe('');
    });

    it('dispatches auto-update pause without an id-existence guard (matches the live command)', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.pauseWorksheetAutoUpdates('sheet-not-in-inventory', signal);

      expect(result.isOk()).toBe(true);
      expect(server.requests.at(-1)?.path).toBe(
        '/v0/workbook/worksheets/sheet-not-in-inventory:pauseAutoUpdates',
      );
    });

    it('lists dashboards', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.listDashboards(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().dashboards?.[0]?.id).toBe('dash-exec');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards');
    });

    it('lists storyboards', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.listStoryboards(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().storyboards?.[0]?.id).toBe('story-qbr');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/storyboards');
    });

    it('gets per-item worksheet XML without fetching the whole workbook document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getWorksheetDocument('sheet-sales', signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().xml).toContain('<worksheet name="Sales by Region"');
      expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/sheet-sales/document');
    });

    it('gets per-item dashboard XML without fetching the whole workbook document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getDashboardDocument('dash-exec', signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().xml).toContain('<dashboard name="Executive Dashboard"');
      expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards/dash-exec/document');
    });

    it('validates workbook XML via the first-class validation endpoint', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.validateWorkbookDocument('<workbook />', signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().isValid).toBe(true);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/document:validate');
    });

    it('gets application info', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getApp(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().build).toBe('20261.26.0701.1234');
      expect(server.requests.at(-1)?.path).toBe('/v0/app');
    });
  });

  describe('request deadline errors', () => {
    const hangingFetch = (): typeof fetch =>
      ((_url: string, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        })) as unknown as typeof fetch;

    it('maps a request timeout to command-timed-out without rescanning discovery', async () => {
      const discover = vi.fn(() => [instanceFor(server)]);
      const executor = new ExternalApiToolExecutor({
        discover,
        clientOptions: { fetchFn: hangingFetch(), timeoutMs: 60 },
      });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.unwrapErr().type).toBe('command-timed-out');
      expect(discover).toHaveBeenCalledTimes(1);
    });

    it('respects caller aborts and maps them to command-timed-out', async () => {
      const discover = vi.fn(() => [instanceFor(server)]);
      const executor = new ExternalApiToolExecutor({
        discover,
        clientOptions: { fetchFn: hangingFetch(), timeoutMs: 60_000 },
      });
      await executor.start();
      const controller = new AbortController();

      const pending = executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal: controller.signal,
      });
      controller.abort();
      const result = await pending;

      expect(result.unwrapErr().type).toBe('command-timed-out');
      expect(discover).toHaveBeenCalledTimes(1);
    });
  });

  describe('401 rescan-once', () => {
    it('emits one logical RPC event across a successful read', async () => {
      const onRpc = vi.fn();
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server, 'valid-token')],
        onRpc,
      });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.isOk()).toBe(true);
      expect(onRpc).toHaveBeenCalledOnce();
      expect(onRpc).toHaveBeenCalledWith({
        operation: 'read',
        durationMs: expect.any(Number),
        transportSuccess: true,
        rescanCount: 0,
      });
    });

    it('emits one logical RPC event when a read rescans after a 401', async () => {
      const onRpc = vi.fn();
      const discover = vi
        .fn()
        .mockReturnValueOnce([instanceFor(server, 'stale-token')])
        .mockReturnValue([instanceFor(server, 'valid-token')]);
      const executor = new ExternalApiToolExecutor({ discover, onRpc });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.isOk()).toBe(true);
      expect(onRpc).toHaveBeenCalledOnce();
      expect(onRpc).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'read', transportSuccess: true, rescanCount: 1 }),
      );
    });

    it('does not let a telemetry callback failure change the RPC result', async () => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server, 'valid-token')],
        onRpc: () => {
          throw new Error('telemetry sink failed');
        },
      });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.isOk()).toBe(true);
    });

    it('does not wait for a telemetry callback that never settles', async () => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server, 'valid-token')],
        onRpc: () => new Promise(() => undefined),
      });
      await executor.start();

      const result = await Promise.race([
        executor.getWorkbookDocument(signal),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RPC waited for telemetry')), 100),
        ),
      ]);

      expect(result.isOk()).toBe(true);
    });

    it('rediscovers once on a 401 and retries with the fresh token', async () => {
      const discover = vi
        .fn()
        .mockReturnValueOnce([instanceFor(server, 'stale-token')])
        .mockReturnValue([instanceFor(server, 'valid-token')]);

      const executor = new ExternalApiToolExecutor({ discover });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().xml).toBe('<workbook><from-desktop /></workbook>');
      expect(discover).toHaveBeenCalledTimes(2);
    });

    it('fails closed when the pinned pid disappears on the 401 rescan instead of retargeting', async () => {
      const other = await startMockExternalApiServer({
        workbookXml: '<workbook><other /></workbook>',
      });
      try {
        const discover = vi
          .fn()
          .mockReturnValueOnce([{ ...instanceFor(server, 'stale-token'), pid: 999 }])
          .mockReturnValue([{ ...instanceFor(other, 'valid-token'), pid: 111 }]); // pinned pid 999 gone

        const executor = new ExternalApiToolExecutor({ pid: 999, discover });
        await executor.start();

        const result = await executor.getWorkbookDocument(signal);

        expect(result.isErr()).toBe(true);
        const error = result.unwrapErr();
        expect(error.type).toBe('unknown');
        if (error.type === 'unknown') {
          expect(String(error.error)).toContain('PID 999');
          expect(String(error.error)).toContain('Call list-instances');
        }
        expect(other.requests).toHaveLength(0);
      } finally {
        await other.close();
      }
    });

    it('gives up after a single rescan when the 401 persists', async () => {
      const discover = vi.fn().mockReturnValue([instanceFor(server, 'always-stale')]);

      const executor = new ExternalApiToolExecutor({ discover });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });

      expect(result.isErr()).toBe(true);
      // start() + one rescan = 2 discover calls, no infinite loop.
      expect(discover).toHaveBeenCalledTimes(2);
    });

    it('does not retry invokeCommand when a 401 rescan changes instance identity at the same pid', async () => {
      const discover = vi
        .fn()
        .mockReturnValueOnce([
          { ...instanceFor(server, 'stale-token'), instanceId: 'inst-expected' },
        ])
        .mockReturnValue([{ ...instanceFor(server, 'valid-token'), instanceId: 'inst-restarted' }]);
      const executor = new ExternalApiToolExecutor({ pid: 999, discover });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'apply-theme',
        expectedInstanceId: 'inst-expected',
        signal,
      });

      expect(result.isErr()).toBe(true);
      expect(
        server.requests.filter(
          (request) => request.method === 'POST' && request.path === '/v0/app:invokeCommand',
        ),
      ).toHaveLength(1);
      expect(discover).toHaveBeenCalledTimes(2);
      const error = result.unwrapErr();
      expect(error.type).toBe('unknown');
      if (error.type === 'unknown') {
        expect(String(error.error)).toContain('inst-expected');
        expect(String(error.error)).toContain('inst-restarted');
      }
    });

    it('does not retry a workbook POST when a 401 rescan finds a new instance with the same pid', async () => {
      const discover = vi
        .fn()
        .mockReturnValueOnce([
          { ...instanceFor(server, 'stale-token'), instanceId: 'inst-expected' },
        ])
        .mockReturnValue([{ ...instanceFor(server, 'valid-token'), instanceId: 'inst-restarted' }]);
      const executor = new ExternalApiToolExecutor({ pid: 999, discover });
      await executor.start();
      const onDispatch = vi.fn();

      const result = await executor.applyWorkbookDocument('<workbook />', signal, {
        expectedInstanceId: 'inst-expected',
        onDispatch,
      });

      expect(result.isErr()).toBe(true);
      expect(onDispatch).toHaveBeenCalledTimes(1);
      expect(
        server.requests.filter(
          (request) => request.method === 'POST' && request.path === '/v0/workbook/document',
        ),
      ).toHaveLength(1);
      expect(discover).toHaveBeenCalledTimes(2);
    });
  });
  describe('async dispatch (202) terminal handling', () => {
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

    it('polls a 202 invokeCommand to completed and parses the polled result', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-x'));
      server.setOperation('op-x', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-x', kind: 'tabdoc:sort', state: 'RUNNING' },
          { id: 'op-x', kind: 'tabdoc:sort', state: 'SUCCEEDED', result: { sorted: true } },
        ],
      });
      const onRpc = vi.fn();
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server)],
        onRpc,
      });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'sort',
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe('completed');
      expect(result.unwrap().result).toEqual({ sorted: true });
      expect(onRpc).toHaveBeenCalledOnce();
      expect(onRpc).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'command',
          transportSuccess: true,
          rescanCount: 0,
        }),
      );
    });

    it('reports a still-running operation as running, never completed', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-run'));
      server.setOperation('op-run', {
        poll: [{ id: 'op-run', kind: 'tabdoc:sort', state: 'RUNNING' }],
      });
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server)],
        clientOptions: { pollDeadlineMs: 50 },
      });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'sort',
        signal,
      });

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('command-timed-out');
      // A poll-timeout is a hang, most likely a modal Desktop can't clear — surface the same
      // dismiss-the-dialog / do-not-retry / list-instances guidance the call-deadline path uses.
      if (error.type === 'command-timed-out') {
        expect(error.error).toContain('Do not retry');
        expect(error.error).toContain('list-instances');
      }
    });

    it('reports a poll-timeout behind a self-clearing progress dialog without blocking-dialog guidance', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-progress'));
      server.setOperation('op-progress', {
        poll: [
          {
            id: 'op-progress',
            kind: 'tabdoc:sort',
            state: 'RUNNING',
            progressWindows: [
              { objectName: 'progress', title: 'Exporting…', className: 'QProgressDialog' },
            ],
          },
        ],
      });
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server)],
        clientOptions: { pollDeadlineMs: 50 },
      });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'sort',
        signal,
      });

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('command-timed-out');
      if (error.type === 'command-timed-out') {
        expect(error.error).toContain('Exporting…');
        expect(error.error).toContain('list-instances');
        expect(error.error).toContain('may still be running');
        expect(error.error).not.toContain('Do not retry');
      }
    });

    it('maps a CANCELLED terminal operation to a command-failed error', async () => {
      server.setOverride('POST /v0/app:invokeCommand', accepted202('op-cancel'));
      server.setOperation('op-cancel', {
        poll: [{ id: 'op-cancel', kind: 'tabdoc:sort', state: 'CANCELLED' }],
      });
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'sort',
        signal,
      });

      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().type).toBe('command-failed');
    });

    it('polls an overflowed JSON read to its terminal result instead of erroring', async () => {
      server.setOverride('GET /v0/workbook/worksheets', accepted202('op-read'));
      server.setOperation('op-read', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-read', kind: 'workbook.listWorksheets', state: 'RUNNING' },
          {
            id: 'op-read',
            kind: 'workbook.listWorksheets',
            state: 'SUCCEEDED',
            result: {
              worksheets: [{ id: 'ws-1', name: 'Sales', hidden: false, isActiveSheet: false }],
            },
          },
        ],
      });
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.listWorksheets(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().worksheets?.[0]?.name).toBe('Sales');
    });

    it('polls an overflowed XML document read to its terminal result.document', async () => {
      server.setOverride('GET /v0/workbook/document', accepted202('op-doc'));
      server.setOperation('op-doc', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-doc', kind: 'workbook.getDocument', state: 'RUNNING' },
          {
            id: 'op-doc',
            kind: 'workbook.getDocument',
            state: 'SUCCEEDED',
            result: { document: '<workbook version="18.1"><worksheets /></workbook>' },
          },
        ],
      });
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getWorkbookDocument(signal);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().xml).toBe('<workbook version="18.1"><worksheets /></workbook>');
    });
  });
});

describe('ExternalApiToolExecutor artifact instance identity', () => {
  const signal = new AbortController().signal;
  const instance = (instanceId: string, token = 'token'): ExternalApiInstance => ({
    baseUrl: 'http://127.0.0.1:1',
    token,
    pid: 999,
    instanceId,
    apiVersion: '0.1.1',
  });

  it('returns the instance identity from the client that served the workbook read', async () => {
    const executor = new ExternalApiToolExecutor({
      discover: () => [instance('inst-read')],
      createClient: (resolved) =>
        ({
          instanceId: resolved.instanceId,
          getXml: vi
            .fn()
            .mockResolvedValue(
              Ok({ xml: '<workbook />', applicationVersion: '2026.1', xsdPayloadVersion: '1' }),
            ),
        }) as unknown as ExternalApiClient,
    });

    const result = await executor.getWorkbookDocument(signal);

    expect(result.unwrap().instanceId).toBe('inst-read');
  });

  it('rejects an expected-instance mismatch before dispatch', async () => {
    const postXmlEnvelope = vi.fn();
    const executor = new ExternalApiToolExecutor({
      discover: () => [instance('inst-new')],
      createClient: (resolved) =>
        ({
          instanceId: resolved.instanceId,
          postXmlEnvelope,
        }) as unknown as ExternalApiClient,
    });
    const onDispatch = vi.fn();

    const result = await executor.applyWorkbookDocument('<workbook />', signal, {
      expectedInstanceId: 'inst-old',
      onDispatch,
    });

    expect(result.isErr()).toBe(true);
    expect(onDispatch).not.toHaveBeenCalled();
    expect(postXmlEnvelope).not.toHaveBeenCalled();
  });

  it('does not retry after a 401 rescan changes instance identity at the same pid', async () => {
    const instances = [instance('inst-expected', 'stale'), instance('inst-restarted', 'fresh')];
    const discover = vi
      .fn()
      .mockReturnValueOnce([instances[0]])
      .mockReturnValueOnce([instances[1]]);
    const firstPost = vi.fn().mockResolvedValue(Err({ type: 'unauthorized', status: 401 }));
    const retryPost = vi
      .fn()
      .mockResolvedValue(
        Ok({ id: 'unexpected', kind: 'workbook.document.apply', state: 'SUCCEEDED' }),
      );
    const executor = new ExternalApiToolExecutor({
      pid: 999,
      discover,
      createClient: (resolved) =>
        ({
          instanceId: resolved.instanceId,
          postXmlEnvelope: resolved.instanceId === 'inst-expected' ? firstPost : retryPost,
        }) as unknown as ExternalApiClient,
    });
    const onDispatch = vi.fn();

    const result = await executor.applyWorkbookDocument('<workbook />', signal, {
      expectedInstanceId: 'inst-expected',
      onDispatch,
    });

    expect(result.isErr()).toBe(true);
    expect(firstPost).toHaveBeenCalledTimes(1);
    expect(retryPost).not.toHaveBeenCalled();
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });
});
