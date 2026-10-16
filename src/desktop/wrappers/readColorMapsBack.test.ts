import { readFileSync } from 'fs';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import { READBACK_POLL_INTERVAL_MS, READBACK_POLL_MAX_ATTEMPTS } from './pollReadback.js';
import { readColorMapsBack } from './readColorMapsBack.js';

const FIXTURE_DIR = join(
  process.cwd(),
  'src',
  'desktop',
  'validation',
  '__fixtures__',
  'color-map',
);

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8');
}

function document(xml: string): {
  xml: string;
  applicationVersion: undefined;
  xsdPayloadVersion: undefined;
} {
  return { xml, applicationVersion: undefined, xsdPayloadVersion: undefined };
}

const signal = new AbortController().signal;

describe('readColorMapsBack', () => {
  afterEach(() => vi.useRealTimers());

  it('makes no Desktop call when the payload carries no color map', async () => {
    const executor = makeExecutorMock();
    const result = await readColorMapsBack({
      appliedXml: '<datasource name="superstore"><column name="[Sales]" /></datasource>',
      datasourceId: 'superstore',
      executor,
      signal,
    });
    expect(result).toBeUndefined();
    expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
    expect(executor.listWorkbookDatasources).not.toHaveBeenCalled();
  });

  it('passes on the first read when the readback carries the map', async () => {
    const executor = makeExecutorMock({
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValue(Ok(document(fixture('rb-L1b-ds.xml')))),
    });
    const result = await readColorMapsBack({
      appliedXml: fixture('apply-L1b-ds.xml'),
      datasourceId: 'superstore',
      executor,
      signal,
    });
    expect(result).toEqual({ ok: true, status: 'passed' });
    expect(executor.getDatasourceDocument).toHaveBeenCalledExactlyOnceWith('superstore', signal);
  });

  it('passes when a mismatching read settles into a match', async () => {
    vi.useFakeTimers();
    const executor = makeExecutorMock({
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValueOnce(Ok(document(fixture('rb-L1a-ds.xml'))))
        .mockResolvedValue(Ok(document(fixture('rb-L1b-ds.xml')))),
    });
    const promise = readColorMapsBack({
      appliedXml: fixture('apply-L1b-ds.xml'),
      datasourceId: 'superstore',
      executor,
      signal,
    });
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    expect(await promise).toEqual({ ok: true, status: 'passed' });
    expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(2);
  });

  it('fails only after the poll budget when the map never appears', async () => {
    vi.useFakeTimers();
    const executor = makeExecutorMock({
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValue(Ok(document(fixture('rb-L1a-ds.xml')))),
    });
    const promise = readColorMapsBack({
      appliedXml: fixture('apply-L1a-ds.xml'),
      datasourceId: 'superstore',
      executor,
      signal,
    });
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const result = await promise;
    expect(result).toMatchObject({ ok: false, status: 'failed' });
    expect(result?.findings).toHaveLength(3);
    expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(READBACK_POLL_MAX_ATTEMPTS);
  });

  it('warns without failing when the document read errors', async () => {
    const executor = makeExecutorMock({
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValue(
          Err({
            type: 'command-failed',
            error: { code: 'not-found', message: 'Datasource not found', recoverable: false },
          }),
        ),
    });
    const result = await readColorMapsBack({
      appliedXml: fixture('apply-L1a-ds.xml'),
      datasourceId: 'superstore',
      executor,
      signal,
    });
    expect(result).toEqual({
      ok: true,
      status: 'warning',
      message: 'color readback unavailable for datasource "superstore": Datasource not found',
      findings: [
        {
          severity: 'warning',
          source: 'color-map',
          message: 'color readback unavailable for datasource "superstore": Datasource not found',
          datasource: 'superstore',
          reason: 'color-readback-unavailable',
        },
      ],
    });
  });

  it('warns instead of throwing when the signal aborts between polls', async () => {
    const controller = new AbortController();
    const executor = makeExecutorMock({
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockImplementation(async () => {
          controller.abort();
          return Ok(document(fixture('rb-L1a-ds.xml')));
        }),
    });
    const result = await readColorMapsBack({
      appliedXml: fixture('apply-L1a-ds.xml'),
      datasourceId: 'superstore',
      executor,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ ok: true, status: 'warning' });
    expect(result?.findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        reason: 'color-readback-unavailable',
        message: expect.stringContaining('the readback was interrupted'),
      }),
    ]);
    expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(1);
  });

  it('warns when the readback document cannot be parsed', async () => {
    const executor = makeExecutorMock({
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValue(Ok(document('<!DOCTYPE x><datasource />'))),
    });
    const result = await readColorMapsBack({
      appliedXml: fixture('apply-L1a-ds.xml'),
      datasourceId: 'superstore',
      executor,
      signal,
    });
    expect(result).toMatchObject({ ok: true, status: 'warning' });
    expect(result?.message).toContain('could not be parsed');
    expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(1);
  });

  it('resolves a worksheet payload datasource by inventory id and reads that document', async () => {
    const executor = makeExecutorMock({
      listWorkbookDatasources: vi
        .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
        .mockResolvedValue(
          Ok({
            datasources: [
              { id: 'Parameters', name: 'Parameters' },
              { id: 'superstore', name: 'superstore' },
            ],
          }),
        ),
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValue(Ok(document(fixture('rb-L2-ds.xml')))),
    });
    const result = await readColorMapsBack({
      appliedXml: fixture('apply-L2-ws.xml'),
      executor,
      signal,
    });
    expect(result).toEqual({ ok: true, status: 'passed' });
    expect(executor.getDatasourceDocument).toHaveBeenCalledExactlyOnceWith('superstore', signal);
  });

  it('matches an encoded inventory id against the decoded XML name', async () => {
    const appliedXml = fixture('apply-L2-ws.xml').replaceAll("'superstore'", "'Sales Extract'");
    const executor = makeExecutorMock({
      listWorkbookDatasources: vi
        .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
        .mockResolvedValue(Ok({ datasources: [{ id: 'Sales%20Extract', name: 'Sales' }] })),
      getDatasourceDocument: vi
        .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
        .mockResolvedValue(Ok(document(fixture('rb-L2-ds.xml')))),
    });
    const result = await readColorMapsBack({ appliedXml, executor, signal });
    expect(result).toEqual({ ok: true, status: 'passed' });
    expect(executor.getDatasourceDocument).toHaveBeenCalledExactlyOnceWith(
      'Sales%20Extract',
      signal,
    );
  });

  it('warns when the datasource is missing from the inventory or the list fails', async () => {
    const missing = makeExecutorMock({
      listWorkbookDatasources: vi
        .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
        .mockResolvedValue(Ok({ datasources: [{ id: 'Parameters', name: 'Parameters' }] })),
    });
    const missingResult = await readColorMapsBack({
      appliedXml: fixture('apply-L2-ws.xml'),
      executor: missing,
      signal,
    });
    expect(missingResult).toMatchObject({ ok: true, status: 'warning' });
    expect(missingResult?.message).toContain('not in the workbook inventory');
    expect(missing.getDatasourceDocument).not.toHaveBeenCalled();

    const listFailed = makeExecutorMock({
      listWorkbookDatasources: vi
        .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
        .mockResolvedValue(Err({ type: 'command-timed-out', error: 'timeout' })),
    });
    const listResult = await readColorMapsBack({
      appliedXml: fixture('apply-L2-ws.xml'),
      executor: listFailed,
      signal,
    });
    expect(listResult).toMatchObject({ ok: true, status: 'warning' });
    expect(listResult?.message).toContain('could not list workbook datasources');
  });
});
