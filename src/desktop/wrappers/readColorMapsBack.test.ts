import { readFileSync } from 'fs';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import {
  formatColorMapCheck,
  formatStaleWorksheetStyleLead,
} from '../validation/colorMapReadback.js';
import { READBACK_POLL_INTERVAL_MS, READBACK_POLL_MAX_ATTEMPTS } from './pollReadback.js';
import { readColorBaseline, readColorMapsBack } from './readColorMapsBack.js';

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
  describe('worksheet <style> maps', () => {
    afterEach(() => vi.useRealTimers());

    function executorReading(
      readback: string,
      id = 'superstore',
    ): ReturnType<typeof makeExecutorMock> {
      return makeExecutorMock({
        listWorkbookDatasources: vi
          .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
          .mockResolvedValue(Ok({ datasources: [{ id, name: id }] })),
        getDatasourceDocument: vi
          .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
          .mockResolvedValue(Ok(document(fixture(readback)))),
      });
    }

    it("fails Andy's shape with the placement hint", async () => {
      vi.useFakeTimers();
      const executor = executorReading('rb-ws-table-fq-ds.xml');
      const applied = fixture('apply-ws-table-fq-ws.xml');
      const promise = readColorMapsBack({
        appliedXml: applied,
        baselineXml: applied.replace(/<style>.*<\/style>/, '<style />'),
        executor,
        signal,
      });
      await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
      const result = await promise;
      expect(result).toMatchObject({ ok: false, status: 'failed' });
      expect(result?.message).toContain(
        '[none:Calculation_B002:nk]: true expected #ff0000, found missing',
      );
      expect(result?.message).toContain(
        "Desktop keeps member colors written in a worksheet's own <style>, and the chart ignores them; put them in the datasource <style> with a datasource-level <column-instance>.",
      );
      expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(READBACK_POLL_MAX_ATTEMPTS);
    });

    it('warns once and never polls when a stale map is re-sent unchanged', async () => {
      const executor = executorReading('rb-ok-L1-before-ds.xml');
      const result = await readColorMapsBack({
        appliedXml: fixture('ok-L1-ws.xml'),
        baselineXml: fixture('ok-L1-ws.xml'),
        executor,
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'skipped' });
      expect(result?.findings).toEqual([
        expect.objectContaining({
          severity: 'warning',
          reason: 'color-worksheet-style-stale',
          message:
            "the worksheet's own <style> also lists member colors for [none:Category:nk] that the chart does not use: Office Supplies #00aa00 (not in the datasource), Technology #d4c37a (not in the datasource), Furniture #ff0000 (not in the datasource)",
        }),
      ]);
      const text = formatStaleWorksheetStyleLead(result) + formatColorMapCheck(result!);
      expect(text).toMatch(/^Applied, but the member colors/);
      expect(text).not.toContain('matched');
      expect(text).not.toContain('not verified');
      expect(text).not.toContain('could not be read before the apply');
      expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(1);
    });

    it('does not fail a stale map beside a dirty-OK datasource with different colors', async () => {
      const executor = executorReading('rb-ok-L1-dirty-ds.xml');
      const result = await readColorMapsBack({
        appliedXml: fixture('ok-L1-ws.xml'),
        baselineXml: fixture('ok-L1-ws.xml'),
        executor,
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'skipped' });
      expect(result?.findings?.[0]?.message).toContain('Furniture #ff0000');
      expect(result?.findings?.[0]?.message).not.toContain('Technology');
      expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(1);
    });

    it('fails only the member that was edited', async () => {
      vi.useFakeTimers();
      const executor = executorReading('rb-ok-L1-before-ds.xml');
      const promise = readColorMapsBack({
        appliedXml: fixture('ok-L1-ws.xml').replace('#ff0000', '#00ff00'),
        baselineXml: fixture('ok-L1-ws.xml'),
        executor,
        signal,
      });
      await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
      const result = await promise;
      expect(result).toMatchObject({ ok: false, status: 'failed' });
      const errors = result?.findings?.filter((finding) => finding.severity === 'error');
      expect(errors).toEqual([
        expect.objectContaining({
          message: '[none:Category:nk]: Furniture expected #00ff00, found missing',
        }),
      ]);
      expect(result?.message).toContain("worksheet's own <style>");
    });

    it('never fails without a baseline, even for a map the datasource lacks', async () => {
      const executor = executorReading('rb-ws-table-fq-ds.xml');
      const result = await readColorMapsBack({
        appliedXml: fixture('apply-ws-table-fq-ws.xml'),
        executor,
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'skipped' });
      expect(formatStaleWorksheetStyleLead(result)).toContain(
        'The sheet could not be read before the apply, so some of these may be new.',
      );
      expect(executor.getDatasourceDocument).toHaveBeenCalledTimes(1);
    });

    function withDepsMap(xml: string, members: Array<[string, string]>): string {
      const maps = members
        .map(([bucket, hex]) => `<map to='${hex}'><bucket>&quot;${bucket}&quot;</bucket></map>`)
        .join('');
      return xml.replace(
        '</datasource-dependencies>',
        `<style><style-rule element='mark'><encoding attr='color' field='[none:Category:nk]' type='palette'>${maps}</encoding></style-rule></style></datasource-dependencies>`,
      );
    }

    it('passes with the stale note when the datasource matches every requested member', async () => {
      const live = fixture('ok-L1-ws.xml');
      const executor = executorReading('rb-ok-L1-dirty-ds.xml');
      const result = await readColorMapsBack({
        appliedXml: withDepsMap(live, [['Furniture', '#4e79a7']]),
        baselineXml: live,
        executor,
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'passed' });
      expect(formatColorMapCheck(result!)).toContain('every requested member color matched.');
      expect(formatStaleWorksheetStyleLead(result)).toContain(
        "the worksheet's own <style> also lists member colors",
      );
      const text = formatColorMapCheck(result!);
      expect(text).not.toContain('not verified');
    });

    it('gives no placement hint for a dropped datasource-level member beside an unchanged stale map', async () => {
      vi.useFakeTimers();
      const live = fixture('ok-L1-ws.xml');
      const executor = executorReading('rb-ok-L1-before-ds.xml');
      const promise = readColorMapsBack({
        appliedXml: withDepsMap(live, [['Furniture', '#123456']]),
        baselineXml: live,
        executor,
        signal,
      });
      await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
      const result = await promise;
      expect(result).toMatchObject({ ok: false, status: 'failed' });
      expect(result?.message).toContain('Furniture expected #123456, found missing');
      expect(result?.message).not.toContain("worksheet's own <style>");
    });

    it("fails a real eval agent's table-style map against Desktop's default palette", async () => {
      vi.useFakeTimers();
      const applied = fixture('apply-r2-ws.xml');
      const baseline = applied.replace(/<style-rule element='mark'>.*?<\/style-rule>\s*/s, '');
      expect(baseline).not.toContain('#ff0000');
      const executor = executorReading('rb-r2-ds.xml', 'start');
      const promise = readColorMapsBack({
        appliedXml: applied,
        baselineXml: baseline,
        executor,
        signal,
      });
      await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
      const result = await promise;
      expect(result).toMatchObject({ ok: false, status: 'failed' });
      expect(result?.message).toBe(
        "1 requested member color(s) did not take: [none:Category:nk]: Furniture expected #ff0000, found #f28e2b. Do not tell the user these colors are set. Desktop keeps member colors written in a worksheet's own <style>, and the chart ignores them; put them in the datasource <style> with a datasource-level <column-instance>.",
      );
    });

    it('names the datasource color in a stale note and makes no claim', async () => {
      const applied = fixture('apply-r2-ws.xml');
      const executor = executorReading('rb-r2-ds.xml', 'start');
      const result = await readColorMapsBack({
        appliedXml: applied,
        baselineXml: applied,
        executor,
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'skipped' });
      expect(result?.findings?.[0]?.message).toContain(
        'Furniture #ff0000 (the chart uses #f28e2b)',
      );
    });

    function liveWorkbook({ sheetMap }: { sheetMap: boolean }): string {
      const ds = fixture('rb-r2-ds.xml').replace(/<!--.*?-->\s*/s, '');
      const rule = /<style-rule element='mark'>.*?<\/style-rule>/s.exec(ds)![0];
      const twoCopies = ds.replace(rule, `${rule}${rule}`);
      let sheet = fixture('apply-r2-ws.xml').replace(/<!--.*?-->\s*/s, '');
      if (!sheetMap) sheet = sheet.replace(/<style-rule element='mark'>.*?<\/style-rule>\s*/s, '');
      return `<workbook><datasources>${twoCopies}</datasources><worksheets>${sheet}</worksheets></workbook>`;
    }

    it("fails a new sheet map against the datasource's default palette in a workbook payload", async () => {
      vi.useFakeTimers();
      const executor = executorReading('rb-r2-ds.xml', 'start');
      const promise = readColorMapsBack({
        appliedXml: liveWorkbook({ sheetMap: true }),
        baselineXml: liveWorkbook({ sheetMap: false }),
        workbookApply: true,
        executor,
        signal,
      });
      await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
      const result = await promise;
      expect(result).toMatchObject({ ok: false, status: 'failed' });
      expect(result?.findings?.filter((finding) => finding.severity === 'error')).toEqual([
        expect.objectContaining({
          message: '[none:Category:nk]: Furniture expected #ff0000, found #f28e2b',
          reason: 'color-mismatch',
        }),
      ]);
      expect(result?.message).toContain("worksheet's own <style>");
      expect(result?.message).not.toContain('does not replace');
    });

    it('says apply-workbook keeps an existing datasource map when a requested color differs', async () => {
      vi.useFakeTimers();
      const applied = liveWorkbook({ sheetMap: false }).replaceAll('#f28e2b', '#00ff00');
      const run = async (
        workbookApply: boolean,
      ): Promise<Awaited<ReturnType<typeof readColorMapsBack>>> => {
        const promise = readColorMapsBack({
          appliedXml: applied,
          workbookApply,
          executor: executorReading('rb-r2-ds.xml', 'start'),
          signal,
        });
        await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
        return promise;
      };
      const hint =
        'apply-workbook does not replace a datasource color map that already exists; change member colors with apply-datasource.';
      expect((await run(true))?.message).toContain(hint);
      expect((await run(false))?.message).not.toContain(hint);
    });

    it('warns instead of throwing when listing datasources or reading the baseline throws', async () => {
      const executor = makeExecutorMock({
        listWorkbookDatasources: vi
          .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
          .mockRejectedValue(new Error('socket closed')),
      });
      const result = await readColorMapsBack({
        appliedXml: fixture('apply-L2-ws.xml'),
        executor,
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'warning' });
      expect(result?.message).toContain('could not list workbook datasources: socket closed');
      expect(
        await readColorBaseline({
          appliedXml: fixture('apply-r2-ws.xml'),
          read: async () => {
            throw new Error('boom');
          },
        }),
      ).toBeUndefined();
    });

    const ds1 = (name: string, members: Array<[string, string]>): string => {
      const maps = members
        .map(([bucket, hex]) => `<map to='${hex}'><bucket>&quot;${bucket}&quot;</bucket></map>`)
        .join('');
      return `<datasource name='${name}'><column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' /><style><style-rule element='mark'><encoding attr='color' field='[none:Category:nk]' type='palette'>${maps}</encoding></style-rule></style></datasource>`;
    };
    const DEFAULT_PALETTE: Array<[string, string]> = [
      ['Technology', '#4e79a7'],
      ['Office Supplies', '#e15759'],
      ['Furniture', '#f28e2b'],
    ];
    const sheetWith = (name: string, tableStyle: string, paneStyle = ''): string =>
      `<worksheet name='${name}'><table><view><datasources><datasource name='ds1' /></datasources><datasource-dependencies datasource='ds1'><column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' /></datasource-dependencies></view>${tableStyle}<panes><pane>${paneStyle}</pane></panes></table></worksheet>`;
    const mapStyle = (hex: string): string =>
      `<style><style-rule element='mark'><encoding attr='color' field='[none:Category:nk]' type='palette'><map to='${hex}'><bucket>&quot;Furniture&quot;</bucket></map></encoding></style-rule></style>`;
    const workbookOf = (datasources: string[], sheets: string[]): string =>
      `<workbook><datasources>${datasources.join('')}</datasources><worksheets>${sheets.join('')}</worksheets></workbook>`;

    function readingMany(readbacks: Record<string, string>): ReturnType<typeof makeExecutorMock> {
      return makeExecutorMock({
        listWorkbookDatasources: vi
          .fn<ExternalApiToolExecutor['listWorkbookDatasources']>()
          .mockResolvedValue(
            Ok({ datasources: Object.keys(readbacks).map((id) => ({ id, name: id })) }),
          ),
        getDatasourceDocument: vi
          .fn<ExternalApiToolExecutor['getDatasourceDocument']>()
          .mockImplementation(async (id: string) => Ok(document(readbacks[id]))),
      });
    }

    async function runSettled(
      args: Parameters<typeof readColorMapsBack>[0],
    ): Promise<Awaited<ReturnType<typeof readColorMapsBack>>> {
      vi.useFakeTimers();
      const promise = readColorMapsBack(args);
      await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS * 4);
      return promise;
    }

    it('does not fail when only one of two sheets with different stale maps drops its map', async () => {
      const dataSource = ds1('ds1', DEFAULT_PALETTE);
      const result = await runSettled({
        appliedXml: workbookOf(
          [dataSource],
          [sheetWith('S1', mapStyle('#ff0000')), sheetWith('S2', '')],
        ),
        baselineXml: workbookOf(
          [dataSource],
          [sheetWith('S1', mapStyle('#ff0000')), sheetWith('S2', mapStyle('#00ff00'))],
        ),
        workbookApply: true,
        executor: readingMany({ ds1: dataSource }),
        signal,
      });
      expect(result?.ok).toBe(true);
    });

    it('does not fail when a pane map is removed beside an old table map', async () => {
      const dataSource = ds1('ds1', DEFAULT_PALETTE);
      const result = await runSettled({
        appliedXml: sheetWith('S1', mapStyle('#ff0000')),
        baselineXml: sheetWith('S1', mapStyle('#ff0000'), mapStyle('#00ff00')),
        executor: readingMany({ ds1: dataSource }),
        signal,
      });
      expect(result?.ok).toBe(true);
    });

    it('does not fail when two sheets with different stale maps swap order', async () => {
      const dataSource = ds1('ds1', DEFAULT_PALETTE);
      const s1 = sheetWith('S1', mapStyle('#ff0000'));
      const s2 = sheetWith('S2', mapStyle('#00ff00'));
      const result = await runSettled({
        appliedXml: workbookOf([dataSource], [s2, s1]),
        baselineXml: workbookOf([dataSource], [s1, s2]),
        workbookApply: true,
        executor: readingMany({ ds1: dataSource }),
        signal,
      });
      expect(result?.ok).toBe(true);
    });

    it('reports the same failure for every datasource that has it', async () => {
      const recolor: Array<[string, string]> = [['Furniture', '#ff0000']];
      const result = await runSettled({
        appliedXml: workbookOf([ds1('ds1', recolor), ds1('ds2', recolor)], []),
        workbookApply: true,
        executor: readingMany({
          ds1: ds1('ds1', DEFAULT_PALETTE),
          ds2: ds1('ds2', DEFAULT_PALETTE),
        }),
        signal,
      });
      expect(
        result?.findings
          ?.filter((finding) => finding.severity === 'error')
          .map((f) => f.datasource),
      ).toEqual(['ds1', 'ds2']);
    });

    it.each([
      ['f1', 'datasource green, dependency red: the chart is red'],
      ['f2', 'datasource red, dependency green: the chart is green'],
    ])(
      'passes live smoke %s, where the readback keeps a leftover second copy (%s)',
      async (tag) => {
        const name = 'federated.zfru97lfbdy7xggra2seh2uwxf6o';
        const result = await readColorMapsBack({
          appliedXml: fixture(`apply-smoke-${tag}-wb.xml`),
          baselineXml: fixture(`apply-smoke-${tag}-wb.xml`).replace(
            /<style><style-rule.*?<\/style>(?=\s*<\/datasource-dependencies>)/s,
            '',
          ),
          workbookApply: true,
          executor: executorReading(`rb-smoke-${tag}-ds.xml`, name),
          signal,
        });
        expect(result).toMatchObject({ ok: true, status: 'passed' });
      },
    );

    it('passes when a stale dependency copy follows the datasources copy and the readback matches it', async () => {
      const result = await runSettled({
        appliedXml: workbookOf(
          [ds1('ds1', [['Furniture', '#ff0000']])],
          [
            sheetWith('S1', '').replace(
              '</datasource-dependencies>',
              `${mapStyle('#f28e2b')}</datasource-dependencies>`,
            ),
          ],
        ),
        workbookApply: true,
        executor: readingMany({ ds1: ds1('ds1', [['Furniture', '#f28e2b']]) }),
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'passed' });
    });

    const SMOKE_DS = 'federated.zfru97lfbdy7xggra2seh2uwxf6o';

    it('passes re-applying the get-workbook-xml state after f1, where Desktop merged the copies (R1)', async () => {
      const result = await readColorMapsBack({
        appliedXml: fixture('apply-smoke-r1-wb.xml'),
        workbookApply: true,
        executor: executorReading('rb-smoke-r1-ds.xml', SMOKE_DS),
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'passed' });
    });

    it('passes apply-datasource of the f1 shape, where the readback copies agree (R2)', async () => {
      const result = await readColorMapsBack({
        appliedXml: fixture('apply-smoke-r2-ds.xml'),
        datasourceId: SMOKE_DS,
        executor: executorReading('rb-smoke-r2-ds.xml', SMOKE_DS),
        signal,
      });
      expect(result).toMatchObject({ ok: true, status: 'passed' });
    });

    it('treats an unparseable baseline as no baseline', async () => {
      const applied = fixture('apply-r2-ws.xml');
      expect(
        await readColorBaseline({ appliedXml: applied, read: async () => Ok('<<<not xml') }),
      ).toBeUndefined();
      expect(await readColorBaseline({ appliedXml: applied, read: async () => Ok(applied) })).toBe(
        applied,
      );
      expect(
        await readColorBaseline({ appliedXml: applied, read: async () => Err('timeout') }),
      ).toBeUndefined();
    });

    it('makes no call for worksheet styles with only numeric buckets', async () => {
      const executor = makeExecutorMock();
      const result = await readColorMapsBack({
        appliedXml:
          "<worksheet name='S'><table><view><datasource-dependencies datasource='superstore' /></view><style><style-rule element='mark'><encoding attr='color' field='[superstore].[none:Quantity:ok]' type='palette'><map to='#ff0000'><bucket>1</bucket></map></encoding></style-rule></style></table></worksheet>",
        baselineXml: '<worksheet name="S"><table /></worksheet>',
        executor,
        signal,
      });
      expect(result).toBeUndefined();
      expect(executor.listWorkbookDatasources).not.toHaveBeenCalled();
      expect(executor.getDatasourceDocument).not.toHaveBeenCalled();
    });
  });
});
