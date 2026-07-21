import { z } from 'zod';

import * as logger from '../../logging/logger.js';
import { ExternalApiToolExecutor } from './externalApiToolExecutor.js';
import { MockExternalApiServer, startMockExternalApiServer } from './mockExternalApiServer.js';
import { ExternalApiInstance } from './types.js';

vi.mock('../../logging/logger.js');

const instanceFor = (
  server: MockExternalApiServer,
  token = 'valid-token',
): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token,
  pid: 999,
  instanceId: 'inst-exec',
  apiVersion: '1.0',
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
        expect(String(error.error)).toContain('pid 12345');
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

  describe('executeCommand routing', () => {
    it('routes save-underlying-metadata to GET /v0/workbook/document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'save-underlying-metadata',
        args: { 'is-json': false },
        schema: z.object({ text: z.string() }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult.text).toBe('<workbook><from-desktop /></workbook>');

      const last = server.requests.at(-1);
      expect(last?.method).toBe('GET');
      expect(last?.path).toBe('/v0/workbook/document');
    });

    it('routes load-underlying-metadata (text) to POST /v0/workbook/document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const xml = '<workbook><applied /></workbook>';
      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'load-underlying-metadata',
        args: { text: xml },
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().status).toBe('completed');

      const last = server.requests.at(-1);
      expect(last?.method).toBe('POST');
      expect(last?.path).toBe('/v0/workbook/document');
      expect(last?.body).toBe(xml);
    });

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

  describe('401 rescan-once', () => {
    it('rediscovers once on a 401 and retries with the fresh token', async () => {
      const discover = vi
        .fn()
        .mockReturnValueOnce([instanceFor(server, 'stale-token')])
        .mockReturnValue([instanceFor(server, 'valid-token')]);

      const executor = new ExternalApiToolExecutor({ discover });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'save-underlying-metadata',
        args: { 'is-json': false },
        schema: z.object({ text: z.string() }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult.text).toBe('<workbook><from-desktop /></workbook>');
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

        const result = await executor.executeCommand({
          namespace: 'tabui',
          command: 'save-underlying-metadata',
          args: { 'is-json': false },
          schema: z.object({ text: z.string() }),
          signal,
        });

        expect(result.isErr()).toBe(true);
        const error = result.unwrapErr();
        expect(error.type).toBe('unknown');
        if (error.type === 'unknown') {
          expect(String(error.error)).toContain('pid 999');
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
  });

  describe('getEvents', () => {
    it('reports that events are not supported by the External Client API', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.getEvents({ signal });
      expect(result.isErr()).toBe(true);
    });
  });
});
