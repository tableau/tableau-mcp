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
  });

  describe('executeCommand routing', () => {
    it('routes save-underlying-metadata to GET /v1/workbook/document', async () => {
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
      expect(last?.path).toBe('/v1/workbook/document');
    });

    it('routes load-underlying-metadata (text) to POST /v1/workbook/document', async () => {
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
      expect(last?.path).toBe('/v1/workbook/document');
      expect(last?.body).toBe(xml);
    });

    it('routes any other command to POST /v1/app:invokeCommand', async () => {
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
      expect(last?.path).toBe('/v1/app:invokeCommand');
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

  // ── W60 P0-1 Fix 3: refuse, don't pick-first, on pid-pinned ambiguity ────────
  // This is the direct regression test for the teardown's demonstrated attack: a
  // forged discovery entry claiming the REAL Desktop pid, sorted ahead of the real
  // entry by a future `startedAt`. Pre-fix, `instances.find(pid===X) ?? instances[0]`
  // silently connected to whichever sorted first (the forged entry). Post-fix, ANY
  // pid collision refuses outright rather than guessing which entry is real.
  describe('pid-pinned ambiguity refusal', () => {
    it('refuses and never connects when two discovery entries claim the same pinned pid', async () => {
      const createClient = vi.fn();
      const real: ExternalApiInstance = instanceFor(server);
      // The "forged" entry sorts first (discover() returns newest-startedAt-first
      // per discovery.ts) but shares the real pid — this is attack A/B verbatim.
      const forged: ExternalApiInstance = {
        ...real,
        baseUrl: 'http://127.0.0.1:9/attacker',
        instanceId: 'forged',
      };

      const executor = new ExternalApiToolExecutor({
        discover: () => [forged, real],
        pid: real.pid,
        createClient,
      });
      await executor.start();

      expect(executor.isAvailable()).toBe(false);
      // No connection is ever attempted — not to the forged instance, not to the real one.
      expect(createClient).not.toHaveBeenCalled();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });
      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('unknown');
      if (error.type === 'unknown') {
        expect(String(error.error)).toContain('2');
        expect(String(error.error)).toContain(String(real.pid));
      }
      expect(createClient).not.toHaveBeenCalled();
    });

    it('refuses (no-instance) rather than falling back to an unrelated instance when zero entries match the pinned pid', async () => {
      const createClient = vi.fn();
      const unrelated: ExternalApiInstance = {
        ...instanceFor(server),
        pid: 111,
        instanceId: 'unrelated',
      };

      const executor = new ExternalApiToolExecutor({
        discover: () => [unrelated],
        pid: 999,
        createClient,
      });
      await executor.start();

      expect(executor.isAvailable()).toBe(false);
      expect(createClient).not.toHaveBeenCalled();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });
      expect(result.isErr()).toBe(true);
      expect(result.unwrapErr().type).toBe('unknown');
      expect(createClient).not.toHaveBeenCalled();
    });

    it('connects normally when exactly one discovery entry matches the pinned pid', async () => {
      const executor = new ExternalApiToolExecutor({
        discover: () => [instanceFor(server)],
        pid: 999,
      });
      await executor.start();

      expect(executor.isAvailable()).toBe(true);
    });

    it('unpinned (no deps.pid) still takes instances[0] even with multiple instances present', async () => {
      const newest: ExternalApiInstance = { ...instanceFor(server), instanceId: 'newest', pid: 1 };
      const older: ExternalApiInstance = { ...instanceFor(server), instanceId: 'older', pid: 2 };

      const executor = new ExternalApiToolExecutor({
        discover: () => [newest, older],
      });
      await executor.start();

      expect(executor.isAvailable()).toBe(true);
    });

    it("mapClientError names the pid and count for an 'ambiguous-pid' failure", async () => {
      const real: ExternalApiInstance = instanceFor(server);
      const forged: ExternalApiInstance = { ...real, instanceId: 'forged' };

      const executor = new ExternalApiToolExecutor({
        discover: () => [forged, real],
        pid: real.pid,
      });
      await executor.start();

      const result = await executor.executeCommand({
        namespace: 'tabdoc',
        command: 'undo',
        signal,
      });
      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      if (error.type === 'unknown') {
        expect(String(error.error)).toMatch(new RegExp(`2.*${real.pid}|${real.pid}.*2`));
      } else {
        throw new Error(`expected 'unknown', got ${error.type}`);
      }
    });
  });
});
