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

    it('routes list-worksheets to GET /v0/workbook/worksheets', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'list-worksheets',
        schema: z.object({ worksheets: z.array(z.object({ id: z.string(), name: z.string() })) }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult.worksheets[0]).toMatchObject({
        id: 'w1',
        name: 'Sheet 1',
      });

      const last = server.requests.at(-1);
      expect(last?.method).toBe('GET');
      expect(last?.path).toBe('/v0/workbook/worksheets');
    });

    it('routes get-worksheet-document to GET /v0/workbook/worksheets/{id}/document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'get-worksheet-document',
        args: { id: 'w1' },
        schema: z.object({ text: z.string() }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult.text).toContain("<worksheet name='w1'>");
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/w1/document');
    });

    it('routes get-worksheet-summary-data to GET /v0/workbook/worksheets/{id}/summaryData', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'get-worksheet-summary-data',
        args: { id: 'w1', maxRows: 5 },
        schema: z.object({ rows: z.array(z.array(z.unknown())) }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult.rows).toHaveLength(2);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/worksheets/w1/summaryData');
    });

    it('routes list-dashboards to GET /v0/workbook/dashboards', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'list-dashboards',
        schema: z.object({ dashboards: z.array(z.object({ id: z.string(), name: z.string() })) }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards');
    });

    it('routes get-dashboard-document to GET /v0/workbook/dashboards/{id}/document', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'get-dashboard-document',
        args: { id: 'd1' },
        schema: z.object({ text: z.string() }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards/d1/document');
    });

    it.each([
      ['get-worksheet', { id: 'w1' }, '/v0/workbook/worksheets/w1'],
      ['get-dashboard', { id: 'd1' }, '/v0/workbook/dashboards/d1'],
      ['list-storyboards', {}, '/v0/workbook/storyboards'],
      ['get-storyboard', { id: 's1' }, '/v0/workbook/storyboards/s1'],
      ['get-storyboard-document', { id: 's1' }, '/v0/workbook/storyboards/s1/document'],
      ['get-workbook-inventory', {}, '/v0/workbook'],
      ['list-workbook-datasources', {}, '/v0/workbook/datasources'],
      ['get-site', {}, '/v0/site'],
      ['list-site-datasources', {}, '/v0/site/datasources'],
      ['list-site-workbooks', {}, '/v0/site/workbooks'],
    ])('routes %s to GET %s', async (command, args, expectedPath) => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command,
        args,
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(server.requests.at(-1)?.method).toBe('GET');
      expect(server.requests.at(-1)?.path).toBe(expectedPath);
    });

    it('routes validate-workbook-document to POST /v0/workbook/document:validate', async () => {
      const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabui',
        command: 'validate-workbook-document',
        args: { text: '<workbook />' },
        schema: z.object({ isValid: z.boolean() }),
        signal,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().parsedResult.isValid).toBe(true);
      expect(server.requests.at(-1)?.method).toBe('POST');
      expect(server.requests.at(-1)?.path).toBe('/v0/workbook/document:validate');
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
