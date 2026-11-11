import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as cachePathModule from '../../../desktop/cachePath.js';
import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { makeExecutorMock } from '../../../desktop/externalApi/executor.mock.js';
import type {
  ExecuteCommandError,
  ExecuteCommandWarning,
} from '../../../desktop/externalApi/executorTypes.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { sidecarPath } from '../../../desktop/wrappers/cacheFingerprint.js';
import { READBACK_POLL_INTERVAL_MS } from '../../../desktop/wrappers/pollReadback.js';
import * as loggerModule from '../../../logging/logger.js';
import { notifier } from '../../../logging/notification.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApplyDatasourceTool } from './applyDatasource.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const successSchema = z.object({
  message: z.string(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});

const structuredSchema = successSchema.extend({
  nextAction: z.object({
    kind: z.literal('done'),
    label: z.string(),
    receipt: z.object({
      did: z.array(z.string()),
      didNot: z.array(z.string()),
      unverified: z.array(z.string()),
    }),
  }),
});

function colorFixture(name: string): string {
  return readFileSync(
    join(process.cwd(), 'src', 'desktop', 'validation', '__fixtures__', 'color-map', name),
    'utf8',
  );
}

const routeMissing: ExecuteCommandError = {
  type: 'command-failed',
  error: {
    code: 'not-found',
    message: 'No route matches POST /v0/workbook/datasources/target/document',
    recoverable: false,
  },
};

describe('getApplyDatasourceTool', () => {
  const temporaryPaths: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('123'));
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([
      {
        pid: 123,
        instanceId: 'instance-123',
      } as ReturnType<typeof externalDiscovery.discoverInstances>[number],
    ]);
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(notifier, 'debug').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function cacheDirectory(label: string): string {
    const directory = mkdtempSync(
      join(cachePathModule.getCacheDir(), `apply-datasource-${label}-`),
    );
    temporaryPaths.push(directory);
    return directory;
  }

  function outsideDirectory(label: string): string {
    const directory = mkdtempSync(join(tmpdir(), `apply-datasource-outside-${label}-`));
    temporaryPaths.push(directory);
    return directory;
  }

  function datasourceFile(label: string, xml = '<datasource name="Sales"/>'): string {
    const file = join(cacheDirectory(label), 'datasource.xml');
    writeFileSync(file, xml);
    return file;
  }

  function writeMatchingSidecar(file: string, overrides: Record<string, unknown> = {}): void {
    writeFileSync(
      sidecarPath(file),
      JSON.stringify({
        session_id: '123',
        pid: 123,
        instanceId: 'instance-123',
        created_at: '2026-09-01T00:00:00Z',
        ...overrides,
      }),
    );
  }

  it('has the expected schema, annotations, and API floor', () => {
    const tool = getApplyDatasourceTool(new DesktopMcpServer());

    expect(tool.name).toBe('apply-datasource');
    expect(tool.description).toBe(
      'Replace an existing datasource definition in the open workbook using a document previously retrieved from that workbook. ' +
        'Does not add datasources or import .tds/.tdsx files.',
    );
    expect(tool.minApiVersion).toBe('0.2.10');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      datasourceName: expect.any(Object),
      datasourceFile: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it.each([
    {
      label: 'exact inventory id',
      datasourceName: 'shared',
      datasources: [
        { id: 'shared', name: 'Resolved by id' },
        { id: 'other', name: 'shared' },
      ],
      expectedId: 'shared',
    },
    {
      label: 'unique name',
      datasourceName: 'Profit',
      datasources: [{ id: 'Profit%2FExtract', name: 'Profit' }],
      expectedId: 'Profit%2FExtract',
    },
    {
      label: 'entity-decoded name',
      datasourceName: 'Sales &amp; Profit',
      datasources: [{ id: 'Sales%20%26%20Profit', name: 'Sales & Profit' }],
      expectedId: 'Sales%20%26%20Profit',
    },
  ])(
    'resolves $label before applying the cached bytes',
    async ({ datasourceName, datasources, expectedId }) => {
      const xml = '\n <datasource name="unchanged"> <connection/> </datasource> \n';
      const file = datasourceFile(`resolution-${expectedId.replaceAll('%', '_')}`, xml);
      writeMatchingSidecar(file);

      const { result, order, executor } = await invoke({ datasourceName, datasources, file });

      expect(result.isError).toBe(false);
      expect(order).toEqual(['list', `apply:${expectedId}`]);
      expect(executor.applyDatasourceDocument).toHaveBeenCalledWith(
        expectedId,
        xml,
        expect.any(Object),
      );
      expect(executor.getWorkbookDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      datasourceName: 'Duplicate',
      datasources: [
        { id: 'first', name: 'Duplicate' },
        { id: 'second', name: 'Duplicate' },
      ],
      expected: 'matched multiple datasources',
    },
    {
      datasourceName: 'Missing',
      datasources: [{ id: 'sales', name: 'Sales' }],
      expected: 'was not found',
    },
  ])(
    'does not read the supplied file or POST when resolution fails for $datasourceName',
    async ({ datasourceName, datasources, expected }) => {
      const readSpy = vi.spyOn(cachePathModule, 'readContainedCacheTextFile');
      const { result, order, executor } = await invoke({
        datasourceName,
        datasources,
        file: datasourceFile('must-not-read'),
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(expected);
      expect(order).toEqual(['list']);
      expect(readSpy).not.toHaveBeenCalled();
      expect(executor.applyDatasourceDocument).not.toHaveBeenCalled();
    },
  );

  it('shows Desktop warnings in the text and does not mark the apply done', async () => {
    const file = datasourceFile('receipt');
    writeMatchingSidecar(file);
    const warnings: ExecuteCommandWarning[] = [
      { code: 'datasource-warning', message: 'Desktop normalized one attribute.' },
    ];

    const { result } = await invoke({ datasourceName: 'Sales', file, warnings });

    expect(result.isError).toBe(false);
    const body = successSchema.parse(JSON.parse(resultText(result)));
    expect(body.warnings).toEqual(warnings);
    expect(body.message).not.toContain('Successfully applied');
    expect(body.message).toContain('datasource-warning: Desktop normalized one attribute.');
    expect(body.message).toContain('No post-apply datasource readback ran');
    expect(result.structuredContent).toMatchObject({ nextAction: { kind: 'prefill' } });
  });

  it('emits an honest no-readback receipt for a clean apply', async () => {
    const file = datasourceFile('clean-receipt');
    writeMatchingSidecar(file);

    const { result } = await invoke({ datasourceName: 'Sales', file });

    const body = successSchema.parse(JSON.parse(resultText(result)));
    expect(body.warnings).toEqual([]);
    expect(body.message).toContain('Successfully applied datasource update for "Sales"');
    const structured = structuredSchema.parse(result.structuredContent);
    expect(structured.message).toBe(body.message);
    expect(structured.warnings).toEqual([]);
    expect(structured.nextAction.receipt.didNot).toEqual([]);
    expect(structured.nextAction.receipt.did).toEqual([
      'Desktop accepted the datasource XML apply for "Sales"',
    ]);
    expect(structured.nextAction.receipt.unverified).toEqual([
      'whether the applied datasource retained its intended structure — no structural readback ran (datasource applies have none)',
    ]);
  });

  it('makes no extra Desktop call when the payload carries no color map', async () => {
    const file = datasourceFile('no-color-map');
    writeMatchingSidecar(file);

    const { result, order, executor } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(false);
    expect(order).toEqual(['list', 'apply:Sales%20Extract']);
    expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
    expect(JSON.parse(resultText(result))).not.toHaveProperty('verification');
  });

  describe('color map readback', () => {
    const superstore = [{ id: 'superstore', name: 'superstore' }];

    afterEach(() => vi.useRealTimers());

    it('fails verification for the live L1a payload whose map Desktop dropped, without a tool error', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const file = datasourceFile('color-l1a', colorFixture('apply-L1a-ds.xml'));
      writeMatchingSidecar(file);

      const pending = invoke({
        datasourceName: 'superstore',
        datasources: superstore,
        file,
        readbacks: [colorFixture('rb-L1a-ds.xml')],
      });
      let settled = false;
      void pending.finally(() => (settled = true));
      while (!settled) await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS);
      const { result, executor } = await pending;

      expect(result.isError).toBe(false);
      const body = JSON.parse(resultText(result));
      expect(body.message).toBe(
        'Desktop accepted the datasource update for "superstore", but 3 requested member color(s) did not take: [none:Category:nk]: Furniture expected #59a14f, found missing; [none:Category:nk]: Technology expected #9c755f, found missing; [none:Category:nk]: Office Supplies expected #b07aa1, found missing. Do not tell the user these colors are set. The datasource needs a <column-instance> for [none:Category:nk] next to its <style>.',
      );
      expect(body.verification).toMatchObject({ ok: false, status: 'failed' });
      expect(body.verification.findings).toHaveLength(3);
      expect(result.structuredContent).toMatchObject({
        nextAction: { kind: 'prefill', label: 'Verification failed — diagnose listed findings' },
      });
      expect(executor.getDatasourceDocument).toHaveBeenCalledWith('superstore', expect.anything());
    });

    it('passes verification for the live L1b payload whose map Desktop kept', async () => {
      const file = datasourceFile('color-l1b', colorFixture('apply-L1b-ds.xml'));
      writeMatchingSidecar(file);

      const { result, order } = await invoke({
        datasourceName: 'superstore',
        datasources: superstore,
        file,
        readbacks: [colorFixture('rb-L1b-ds.xml')],
      });

      expect(result.isError).toBe(false);
      expect(order).toEqual(['list', 'apply:superstore', 'read:superstore']);
      const structured = structuredSchema
        .extend({ verification: z.object({ status: z.literal('passed') }) })
        .parse(result.structuredContent);
      expect(structured.message).toBe(
        'Successfully applied datasource update for "superstore". The datasource has been updated. Read back the datasource document: every requested member color matched.',
      );
      expect(structured.nextAction.receipt.did).toEqual([
        'Desktop accepted the datasource XML apply for "superstore"',
        'read back the datasource document: every requested member color matched',
      ]);
    });

    it('keeps the landed apply Ok when the request aborts mid-poll', async () => {
      const controller = new AbortController();
      const file = datasourceFile('color-abort', colorFixture('apply-L1a-ds.xml'));
      writeMatchingSidecar(file);

      const { result, executor } = await invoke({
        datasourceName: 'superstore',
        datasources: superstore,
        file,
        readbacks: [colorFixture('rb-L1a-ds.xml')],
        signal: controller.signal,
        onRead: () => controller.abort(),
      });

      expect(result.isError).toBe(false);
      const body = JSON.parse(resultText(result));
      expect(body.message).toContain('Successfully applied datasource update for "superstore"');
      expect(body.verification).toMatchObject({ ok: true, status: 'warning' });
      expect(body.verification.message).toContain('the readback was interrupted');
      expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(1);
    });

    it('keeps the apply accepted and only warns when the readback cannot be read', async () => {
      const file = datasourceFile('color-read-error', colorFixture('apply-L1b-ds.xml'));
      writeMatchingSidecar(file);

      const { result } = await invoke({
        datasourceName: 'superstore',
        datasources: superstore,
        file,
        readbackError: routeMissing,
      });

      expect(result.isError).toBe(false);
      const structured = structuredSchema.parse(result.structuredContent);
      expect(structured.message).toContain('Successfully applied datasource update');
      expect(structured.message).toContain('Requested member colors are not verified');
      expect(structured.nextAction.receipt.unverified).toContain(
        'whether the requested member colors took — color readback unavailable for datasource "superstore": No route matches POST /v0/workbook/datasources/target/document',
      );
    });
  });

  it.each([
    ['missing', () => join(cacheDirectory('missing'), 'missing.xml')],
    [
      'outside-cache',
      () => {
        const file = join(outsideDirectory('outside'), 'datasource.xml');
        writeFileSync(file, '<datasource/>');
        return file;
      },
    ],
    [
      'final symlink',
      () => {
        const outside = join(outsideDirectory('final-symlink'), 'outside.xml');
        writeFileSync(outside, '<outside/>');
        const candidate = join(cacheDirectory('final-symlink'), 'datasource.xml');
        symlinkSync(outside, candidate);
        return candidate;
      },
    ],
    [
      'intermediate symlink',
      () => {
        const outside = outsideDirectory('intermediate-symlink');
        writeFileSync(join(outside, 'datasource.xml'), '<outside/>');
        const directory = cacheDirectory('intermediate-symlink');
        symlinkSync(outside, join(directory, 'linked'));
        return join(directory, 'linked', 'datasource.xml');
      },
    ],
  ] as const)('refuses a %s file before any Desktop call', async (_label, makeFile) => {
    const file = makeFile();
    const { result, order, executor } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(true);
    expect(order).toEqual([]);
    expect(executor.applyDatasourceDocument).not.toHaveBeenCalled();
  });

  it('maps a secure descriptor read failure to the existing file-read error', async () => {
    const file = datasourceFile('unreadable');
    vi.spyOn(cachePathModule, 'readContainedCacheTextFile').mockReturnValueOnce({
      ok: false,
      issue: 'read-error',
      error: new Error('injected descriptor read failure'),
    });

    const { result, order, executor } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('injected descriptor read failure');
    expect(order).toEqual(['list']);
    expect(executor.applyDatasourceDocument).not.toHaveBeenCalled();
  });

  it('allows a missing sidecar and applies the securely read primary file', async () => {
    const file = datasourceFile('missing-sidecar');

    const { result, order } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(false);
    expect(order).toEqual(['list', 'apply:Sales%20Extract']);
  });

  it('allows an unsafe sidecar without consuming its escaped fingerprint', async () => {
    const file = datasourceFile('unsafe-sidecar');
    const escapedSidecar = join(outsideDirectory('unsafe-sidecar'), 'escaped.meta.json');
    writeFileSync(
      escapedSidecar,
      JSON.stringify({
        session_id: '999',
        pid: 999,
        instanceId: 'outside-instance',
        created_at: '2026-09-01T00:00:00Z',
      }),
    );
    symlinkSync(escapedSidecar, sidecarPath(file));

    const { result, order } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(false);
    expect(order).toEqual(['list', 'apply:Sales%20Extract']);
  });

  it('allows safely read but malformed sidecar content', async () => {
    const file = datasourceFile('malformed-sidecar');
    writeFileSync(sidecarPath(file), 'not json');

    const { result } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(false);
  });

  it('refuses a safely read sidecar fingerprint mismatch before POST', async () => {
    const file = datasourceFile('fingerprint-mismatch');
    writeMatchingSidecar(file, {
      session_id: '999',
      pid: 999,
      instanceId: 'old-instance',
    });

    const { result, order, executor } = await invoke({ datasourceName: 'Sales', file });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('different Tableau Desktop session');
    expect(order).toEqual(['list']);
    expect(executor.applyDatasourceDocument).not.toHaveBeenCalled();
  });

  it('maps missing inventory and granular routes separately', async () => {
    const file = datasourceFile('route-missing');

    const listFailure = await invoke({
      datasourceName: 'Sales',
      file,
      listError: routeMissing,
    });
    expect(listFailure.result.isError).toBe(true);
    expect(resultText(listFailure.result)).toContain('workbook datasources endpoint');
    expect(listFailure.order).toEqual(['list']);

    const applyFailure = await invoke({
      datasourceName: 'Sales',
      file,
      applyError: routeMissing,
    });
    expect(applyFailure.result.isError).toBe(true);
    expect(resultText(applyFailure.result)).toContain('datasource document endpoint');
    expect(applyFailure.order).toEqual(['list', 'apply:Sales%20Extract']);
  });

  it.each([
    ['404 datasource-not-found', 'datasource-not-found', 'The datasource no longer exists.'],
    ['409 conflict', 'conflict', 'The document targets a different datasource.'],
    ['400 empty body', 'invalid-request', 'The datasource document is empty.'],
    ['415 unsupported content type', 'unsupported-media-type', 'Expected an XML document.'],
    ['422 malformed document', 'invalid-xml', 'The datasource document is malformed.'],
    ['async operation failure', 'operation-failed', 'The asynchronous apply failed.'],
  ])('maps %s through DesktopCommandExecutionError', async (_label, code, message) => {
    const file = datasourceFile(`error-${code}`);
    const { result } = await invoke({
      datasourceName: 'Sales',
      file,
      applyError: {
        type: 'command-failed',
        error: { code, message, recoverable: false },
      },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(message);
  });

  it.each([
    ['empty', '', 'The datasource document is empty.'],
    ['malformed', 'not a datasource document', 'The datasource document is malformed.'],
  ])(
    'sends %s cached content unchanged and lets Desktop reject it',
    async (label, xml, message) => {
      const file = datasourceFile(`unchanged-${label}`, xml);
      const { result, executor } = await invoke({
        datasourceName: 'Sales',
        file,
        applyError: {
          type: 'command-failed',
          error: { code: 'invalid-xml', message, recoverable: false },
        },
      });

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(message);
      expect(executor.applyDatasourceDocument).toHaveBeenCalledWith(
        'Sales%20Extract',
        xml,
        expect.any(Object),
      );
    },
  );

  it('passes the request abort signal to inventory and datasource apply calls', async () => {
    const file = datasourceFile('signal');
    const signal = new AbortController().signal;
    const { executor } = await invoke({ datasourceName: 'Sales', file, signal });

    expect(executor.listWorkbookDatasources).toHaveBeenCalledWith(signal);
    expect(executor.applyDatasourceDocument).toHaveBeenCalledWith(
      'Sales%20Extract',
      '<datasource name="Sales"/>',
      signal,
    );
  });

  async function invoke({
    datasourceName,
    file,
    datasources = [{ id: 'Sales%20Extract', name: 'Sales' }],
    warnings = [],
    listError,
    applyError,
    signal,
    readbacks = [],
    readbackError,
    onRead,
  }: {
    datasourceName: string;
    file: string;
    datasources?: Array<Record<string, unknown>>;
    warnings?: ExecuteCommandWarning[];
    listError?: ExecuteCommandError;
    applyError?: ExecuteCommandError;
    signal?: AbortSignal;
    /** Datasource documents returned by successive post-apply reads; the last one repeats. */
    readbacks?: string[];
    readbackError?: ExecuteCommandError;
    onRead?: () => void;
  }): Promise<{
    result: CallToolResult;
    order: string[];
    executor: ReturnType<typeof makeExecutorMock>;
  }> {
    const order: string[] = [];
    const listWorkbookDatasources = vi.fn(async () => {
      order.push('list');
      return listError ? Err(listError) : Ok({ datasources });
    });
    const applyDatasourceDocument = vi.fn(async (id: string) => {
      order.push(`apply:${id}`);
      return applyError
        ? Err(applyError)
        : Ok({
            command_id: 'apply-datasource',
            status: 'completed' as const,
            submitted_at: '2026-09-01T00:00:00Z',
            warnings,
          });
    });
    const applyWorkbookDocument = vi.fn();
    let reads = 0;
    const getDatasourceDocument = vi.fn(async (id: string) => {
      order.push(`read:${id}`);
      onRead?.();
      const xml = readbacks[Math.min(reads++, readbacks.length - 1)] ?? '';
      return readbackError
        ? Err(readbackError)
        : Ok({ xml, applicationVersion: undefined, xsdPayloadVersion: undefined });
    });
    const executor = makeExecutorMock({
      listWorkbookDatasources,
      applyDatasourceDocument,
      applyWorkbookDocument,
      getDatasourceDocument,
    });
    const tool = getApplyDatasourceTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi
        .fn()
        .mockResolvedValue(executor) as unknown as TableauDesktopToolContext['getExecutor'],
      ...(signal === undefined ? {} : { signal }),
    };
    const result = await callback(
      { session: 'requested', datasourceName, datasourceFile: file },
      extra,
    );
    return { result, order, executor };
  }
});

function resultText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
