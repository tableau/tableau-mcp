import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as episodeEvents from '../../../../desktop/episode-events.js';
import type {
  ApplyWorkbookDocumentOptions,
  ExternalApiToolExecutor,
} from '../../../../desktop/externalApi/executorTypes.js';
import { captureTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import {
  TemplateArtifactStore,
  type TemplateWorksheetArtifact,
} from '../../../../desktop/templates/templateArtifactStore.js';
import * as loggerModule from '../../../../logging/logger.js';
import { DesktopMcpServer, getDesktopToolListEntry } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getRunDashboardBatchTool } from './runDashboardBatch.js';

vi.mock('../../../../desktop/session/sessionResolution.js');

const BATCH = {
  dashboardName: 'Executive Overview',
  existingWorksheetNames: ['Existing'],
  title: 'Executive Overview',
  layoutType: 'columns' as const,
};

const WORKBOOK_XML = renderedWorkbook(['Existing', 'Existing A', 'Existing B']);

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('runDashboardBatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('12345'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes a typed flat queue contract with explicit chart and KPI order', async () => {
    const tool = getRunDashboardBatchTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(
      schema.safeParse({ session: '12345', artifactIds: ['a1', 'a2'], ...BATCH }).success,
    ).toBe(true);
    expect(schema.safeParse({ session: '12345', ...BATCH, replaceExisting: true }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        session: '12345',
        artifactIds: ['a1', 'a2'],
        dashboardName: BATCH.dashboardName,
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['New A'],
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ session: '12345', ...BATCH }).success).toBe(true);
    expect(
      schema.safeParse({ session: '12345', artifactIds: Array(7).fill('a'), ...BATCH }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ session: '12345', artifactIds: Array(8).fill('a'), ...BATCH }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ session: '12345', ...BATCH, existingWorksheetNames: Array(7).fill('a') })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ session: '12345', ...BATCH, existingWorksheetNames: Array(8).fill('a') })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ session: '12345', ...BATCH, existingWorksheetNames: [] }).success,
    ).toBe(true);
    const tooLong = 'x'.repeat(256);
    expect(schema.safeParse({ ...BATCH, artifactIds: [tooLong] }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, dashboardName: tooLong }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, existingWorksheetNames: [tooLong] }).success).toBe(false);
    expect(schema.safeParse({ ...BATCH, title: tooLong }).success).toBe(false);

    const entry = await getDesktopToolListEntry(tool);
    expect(entry.title).toBe('Dashboard');
    expect(entry.description).toBe(
      'Apply staged sheets; compose live KPI/chart sheets as a dashboard.',
    );
    expect(entry.inputSchema).toMatchObject({
      properties: {
        session: {
          type: 'string',
          maxLength: 64,
          description: 'Session ID; optional if pinned or unique.',
        },
        artifactIds: { type: 'array', items: { type: 'string' } },
        dashboardName: { type: 'string' },
        existingWorksheetNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Live non-KPI sheets in order.',
        },
        title: { type: 'string' },
        layoutType: {
          type: 'string',
          description: 'executive-summary: KPI + chart roles.',
        },
        gridColumns: { type: 'integer' },
        kpiWorksheetNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Live KPI sheet names, left to right.',
        },
        replaceExisting: { type: 'boolean' },
      },
      required: expect.arrayContaining(['dashboardName']),
    });
    expect(entry.inputSchema.required).not.toContain('existingWorksheetNames');
    expect(entry.inputSchema.required).not.toContain('replaceExisting');
    expect(entry.inputSchema.properties).not.toHaveProperty('tasks');
    expect(JSON.stringify(entry).length).toBe(1_310);
  });

  it('records bounded success telemetry without workbook identifiers', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();

    const result = await callBatch(['a1']);

    expect(result.isError).toBe(false);
    const event = emitSpy.mock.calls
      .map(([, value]) => value)
      .find((value) => value.type === 'batch_apply');
    expect(event).toMatchObject({
      type: 'batch_apply',
      session_id: '12345',
      artifact_count: 1,
      existing_worksheet_count: 1,
      duration_ms: expect.any(Number),
      outcome: 'succeeded',
    });
    expect(event).not.toHaveProperty('dashboardName');
    expect(event).not.toHaveProperty('artifactIds');
    expect(event).not.toHaveProperty('worksheetNames');
  });

  it('returns without waiting for the telemetry sink', async () => {
    const emitSpy = vi
      .spyOn(episodeEvents, 'emitEpisodeEvent')
      .mockImplementation(() => new Promise(() => undefined));

    try {
      const result = await Promise.race([
        callBatch(['a1']),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('batch waited for telemetry')), 100),
        ),
      ]);

      expect(result.isError).toBe(false);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('records duplicate and unavailable artifacts as refused', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
    await callBatch(['a1', 'a1'], { store: artifactStore(['a1']) });
    await callBatch(['a1', 'missing'], { store: artifactStore(['a1']) });

    const outcomes = emitSpy.mock.calls
      .map(([, value]) => value)
      .filter((value) => value.type === 'batch_apply')
      .map((value) => value.outcome);
    expect(outcomes).toEqual(['refused', 'refused']);
  });

  it('records abort before dispatch and releases every reservation', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
    const store = artifactStore(['a1', 'a2']);
    const release = vi.spyOn(store, 'release');
    const controller = new AbortController();
    controller.abort();
    const harness = statefulExecutor();

    const result = await callBatch(['a1', 'a2'], {
      store,
      signal: controller.signal,
      executor: harness.executor,
    });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(2);
    const event = emitSpy.mock.calls
      .map(([, value]) => value)
      .find((value) => value.type === 'batch_apply');
    expect(event).toMatchObject({ outcome: 'aborted' });
  });

  it('records ambiguous dispatch as unknown', async () => {
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();
    const harness = statefulExecutor({ failAfterDispatch: true });

    const result = await callBatch(['a1'], { executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({ applied: 'unknown', retrySafe: false });
    const event = emitSpy.mock.calls
      .map(([, value]) => value)
      .find((value) => value.type === 'batch_apply');
    expect(event).toMatchObject({ outcome: 'unknown' });
  });

  it('reserves every artifact before validation and releases all when a later one fails', async () => {
    const store = artifactStore(['a1', 'a2'], {
      worksheetXmls: {
        a2: '<worksheet name="New B"><table><view><filter column="[DS].[none:Category:nk]"><groupfilter function="end" count="0"/></filter></view></table></worksheet>',
      },
    });
    const reserve = vi.spyOn(store, 'reserve');
    const release = vi.spyOn(store, 'release');
    const harness = statefulExecutor();

    const result = await callBatch(['a1', 'a2'], { store, executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(harness.posts).toHaveLength(0);
  });

  it('rejects duplicate ids before reserving', async () => {
    const store = artifactStore(['a1']);
    const reserve = vi.spyOn(store, 'reserve');

    const result = await callBatch(['a1', 'a1'], { store });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects session and Desktop instance mismatches before writing', async () => {
    const sessionMismatch = await callBatch(['a1'], {
      store: artifactStore(['a1'], { sessionId: 'other-session' }),
    });
    const instanceHarness = statefulExecutor();
    const instanceMismatch = await callBatch(['a1'], {
      store: artifactStore(['a1'], { instanceId: 'other-instance' }),
      executor: instanceHarness.executor,
    });

    expect(bodyOf(sessionMismatch)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(instanceMismatch)).toMatchObject({ applied: false, retrySafe: true });
    expect(instanceHarness.posts).toHaveLength(0);
  });

  it('rejects stale artifact target state before writing', async () => {
    const staleXml = WORKBOOK_XML.replace(
      '</worksheets>',
      '<worksheet name="New A"><table/></worksheet></worksheets>',
    ).replace('</windows>', '<window class="worksheet" name="New A"/></windows>');
    const harness = statefulExecutor({ initialXml: staleXml });

    const result = await callBatch(['a1'], { executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
    expect(harness.posts).toHaveLength(0);
  });

  it('reports a workbook change detected immediately before the batch write', async () => {
    const harness = statefulExecutor({ driftBeforeApply: true });

    const result = await callBatch(['a1'], { executor: harness.executor });

    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: expect.arrayContaining([
        expect.objectContaining({
          operation: 'dashboard',
          stage: 'workbookDrift',
          error: 'The workbook changed before the authoring write.',
        }),
      ]),
    });
    expect(harness.posts).toHaveLength(0);
  });

  it('rejects missing existing worksheets before writing', async () => {
    const missing = await callBatch([], { existingWorksheetNames: ['Missing'] });

    expect(bodyOf(missing)).toMatchObject({ applied: false, retrySafe: true });
  });

  it('adds an existing empty worksheet and reports an advisory warning', async () => {
    const unrenderedXml = WORKBOOK_XML.replace(
      '</worksheets>',
      '<worksheet name="Empty"><table/></worksheet></worksheets>',
    ).replace('</windows>', '<window class="worksheet" name="Empty"/></windows>');
    const harness = statefulExecutor({ initialXml: unrenderedXml });

    const result = await callBatch([], {
      existingWorksheetNames: ['Empty'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(bodyOf(result)).toMatchObject({
      steps: [
        expect.objectContaining({
          operation: 'dashboard',
          worksheets: ['Empty'],
          warnings: [
            'Worksheet "Empty" is empty and will display as an empty tile on the dashboard.',
          ],
        }),
      ],
    });
  });

  it('rejects canonical worksheet collisions, dashboard collisions, and more than seven sheets', async () => {
    const canonical = await callBatch(['a1'], {
      store: artifactStore(['a1'], { titles: { a1: 'Existi&#110;g' } }),
    });
    const dashboard = await callBatch(['a1'], {
      store: artifactStore(['a1'], { titles: { a1: 'Executive Overview' } }),
    });
    const tooMany = await callBatch(['a1'], {
      existingWorksheetNames: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'],
      executor: statefulExecutor({
        initialXml: renderedWorkbook(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']),
      }).executor,
    });

    expect(bodyOf(canonical)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(dashboard)).toMatchObject({ applied: false, retrySafe: true });
    expect(bodyOf(tooMany)).toMatchObject({ applied: false, retrySafe: true });
  });

  it('supports compose-only with existing rendered worksheets', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [
        {
          operation: 'dashboard',
          worksheets: ['Existing A', 'Existing B'],
          state: 'applied',
        },
      ],
    });
  });

  it('composes an executive summary with KPI worksheets above analytical views', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Existing A'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.posts[0]).toContain(
      'h="12000" id="11" name="Existing A" w="100000" x="0" y="6000"',
    );
    expect(harness.posts[0]).toContain(
      'h="82000" id="12" name="Existing B" w="100000" x="0" y="18000"',
    );
  });

  it('resolves live KPI role references without duplicating them in existingWorksheetNames', async () => {
    const chartNames = ['Trend', 'Top Products', 'Regional Sales', 'Customer Mix'];
    const kpiNames = ['Total Sales', 'Total Profit', 'Total Quantity'];
    const harness = statefulExecutor({
      initialXml: renderedWorkbook([
        'Customer Mix',
        'Total Quantity',
        'Regional Sales',
        'Total Sales',
        'Top Products',
        'Total Profit',
        'Trend',
      ]),
    });

    const result = await callBatch([], {
      existingWorksheetNames: chartNames,
      layoutType: 'executive-summary',
      kpiWorksheetNames: kpiNames,
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [
        expect.objectContaining({
          operation: 'dashboard',
          worksheets: [...chartNames, ...kpiNames],
        }),
      ],
    });
    const posted = harness.posts[0]!.slice(harness.posts[0]!.indexOf('<dashboards>'));
    expect(posted.indexOf('name="Total Sales"')).toBeLessThan(
      posted.indexOf('name="Total Profit"'),
    );
    expect(posted.indexOf('name="Total Profit"')).toBeLessThan(
      posted.indexOf('name="Total Quantity"'),
    );
    expect(posted.indexOf('name="Trend"')).toBeLessThan(posted.indexOf('name="Top Products"'));
    expect(posted.indexOf('name="Top Products"')).toBeLessThan(
      posted.indexOf('name="Regional Sales"'),
    );
    expect(posted.indexOf('name="Regional Sales"')).toBeLessThan(
      posted.indexOf('name="Customer Mix"'),
    );
  });

  it('unions a KPI role represented in both inputs only once', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Existing A'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      steps: [expect.objectContaining({ worksheets: ['Existing A', 'Existing B'] })],
    });
  });

  it('resolves KPI roles against artifact worksheet titles before the single write', async () => {
    const harness = statefulExecutor();

    const result = await callBatch(['a1', 'a2'], {
      existingWorksheetNames: [],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['New A'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.posts[0]).toContain('h="12000" id="11" name="New A" w="100000" x="0" y="6000"');
    expect(harness.posts[0]).toContain('h="82000" id="12" name="New B" w="100000" x="0" y="18000"');
  });

  it('rejects unknown KPI names and conflicting free-form layout controls before writing', async () => {
    const missingHarness = statefulExecutor();
    const missing = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Missing KPI'],
      executor: missingHarness.executor,
    });
    const conflictHarness = statefulExecutor();
    const conflict = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Existing A'],
      gridColumns: 2,
      executor: conflictHarness.executor,
    });

    expect(bodyOf(missing)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [
        expect.objectContaining({
          stage: 'kpiWorksheet',
          error:
            'Missing live KPI worksheet name(s): "Missing KPI". Create or render each KPI worksheet, or correct kpiWorksheetNames; then retry with the same executive-summary layout.',
        }),
      ],
    });
    expect(bodyOf(conflict)).toMatchObject({ applied: false, retrySafe: true });
    expect(missingHarness.posts).toHaveLength(0);
    expect(conflictHarness.posts).toHaveLength(0);
  });

  it('counts implicit KPI role references toward the seven-worksheet batch limit', async () => {
    const names = [
      'Chart 1',
      'Chart 2',
      'Chart 3',
      'Chart 4',
      'Chart 5',
      'KPI 1',
      'KPI 2',
      'KPI 3',
    ];
    const harness = statefulExecutor({ initialXml: renderedWorkbook(names) });

    const result = await callBatch([], {
      existingWorksheetNames: names.slice(0, 5),
      layoutType: 'executive-summary',
      kpiWorksheetNames: names.slice(5),
      executor: harness.executor,
    });

    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [
        expect.objectContaining({
          stage: 'inputValidation',
          error: 'A dashboard batch requires 1-7 combined worksheets, including KPI roles.',
        }),
      ],
    });
    expect(harness.posts).toHaveLength(0);
  });

  it.each([
    {
      name: 'a missing KPI list',
      worksheetNames: ['Existing A', 'Existing B'],
      kpiWorksheetNames: undefined,
      error: 'layoutType "executive-summary" requires at least one KPI worksheet name.',
    },
    {
      name: 'duplicate KPI names',
      worksheetNames: ['Existing A', 'Existing B'],
      kpiWorksheetNames: ['Existing A', 'Existing A'],
      error: 'Duplicate KPI worksheet name(s): "Existing A".',
    },
    {
      name: 'only KPI worksheets',
      worksheetNames: ['Existing A', 'Existing B'],
      kpiWorksheetNames: ['Existing A', 'Existing B'],
      error: 'layoutType "executive-summary" requires at least one non-KPI worksheet.',
    },
  ])('rejects $name before writing', async ({ worksheetNames, kpiWorksheetNames, error }) => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: worksheetNames,
      layoutType: 'executive-summary',
      kpiWorksheetNames,
      executor: harness.executor,
    });

    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      steps: [expect.objectContaining({ stage: 'inputValidation', error })],
    });
    expect(harness.posts).toHaveLength(0);
  });

  it('returns unknown when Tableau changes Top-N semantics on a composed live worksheet', async () => {
    vi.useFakeTimers();
    const harness = statefulExecutor({
      initialXml: rankedWorkbook(),
      readbackTransform: (xml) =>
        xml.replace('function="end" count="10"', 'function="end" count="50"'),
    });

    const resultPromise = callBatch([], {
      existingWorksheetNames: ['Top Products'],
      executor: harness.executor,
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      steps: [
        expect.objectContaining({
          operation: 'dashboard',
          stage: 'readbackVerification',
          error: expect.stringContaining('Top Products'),
        }),
      ],
    });
    expect(JSON.stringify(bodyOf(result))).toContain('filter');
  });

  describe('same-field shelf reorder readback (W-24366132)', () => {
    const ROWS = '<rows>[Sample - Superstore].[sum:A:qk] + [Sample - Superstore].[sum:B:qk]</rows>';
    const SWAPPED =
      '<rows>[Sample - Superstore].[sum:B:qk] + [Sample - Superstore].[sum:A:qk]</rows>';
    const worksheetXmls = { a1: `<worksheet name="New A"><table>${ROWS}</table></worksheet>` };

    it('keeps polling past a transient reordered read and reports a passed worksheet', async () => {
      vi.useFakeTimers();
      let reads = 0;
      const harness = statefulExecutor({
        readbackTransform: (xml) => (reads++ < 2 ? xml.replace(ROWS, SWAPPED) : xml),
      });

      const resultPromise = callBatch(['a1'], {
        store: artifactStore(['a1'], { worksheetXmls }),
        existingWorksheetNames: [],
        executor: harness.executor,
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(bodyOf(result)).toMatchObject({
        applied: true,
        steps: expect.arrayContaining([
          expect.objectContaining({
            operation: 'worksheet',
            verification: { ok: true, status: 'passed' },
          }),
        ]),
      });
      expect(reads).toBeGreaterThan(2);
    });

    it('accepts a persistent reorder as a warning after the poll budget', async () => {
      vi.useFakeTimers();
      const harness = statefulExecutor({ readbackTransform: (xml) => xml.replace(ROWS, SWAPPED) });

      const resultPromise = callBatch(['a1'], {
        store: artifactStore(['a1'], { worksheetXmls }),
        existingWorksheetNames: [],
        executor: harness.executor,
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(bodyOf(result)).toMatchObject({
        applied: true,
        steps: expect.arrayContaining([
          expect.objectContaining({
            operation: 'worksheet',
            verification: expect.objectContaining({ status: 'warning' }),
          }),
        ]),
      });
    });
  });

  it('keeps seven-artifact warning and failure receipts below the SDK truncation limit', async () => {
    const ids = Array.from({ length: 7 }, (_, index) => `${index}-${'i'.repeat(250)}`);
    const titles = Object.fromEntries(ids.map((id, index) => [id, `${index}-${'t'.repeat(250)}`]));
    const warningXmls = Object.fromEntries(
      ids.map((id) => [
        id,
        `<worksheet name="${titles[id]}"><table><shelf-sort-v2 direction="ASC"/></table></worksheet>`,
      ]),
    );
    const warningHarness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<shelf-sort-v2[^>]*\/>/g, ''),
    });
    const warningResult = await callBatch(ids, {
      store: artifactStore(ids, { titles, worksheetXmls: warningXmls }),
      existingWorksheetNames: [],
      executor: warningHarness.executor,
    });

    expect(warningResult.isError).toBe(false);
    expect(JSON.stringify(bodyOf(warningResult)).length).toBeLessThanOrEqual(8 * 1024);

    vi.useFakeTimers();
    const failedXmls = Object.fromEntries(
      ids.map((id) => [
        id,
        `<worksheet name="${titles[id]}"><table><panes><pane><mark class="Bar"/></pane></panes></table></worksheet>`,
      ]),
    );
    const failureHarness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<mark class="Bar"/g, '<mark class="Circle"'),
    });
    const failurePromise = callBatch(ids, {
      store: artifactStore(ids, { titles, worksheetXmls: failedXmls }),
      existingWorksheetNames: [],
      executor: failureHarness.executor,
    });
    await vi.runAllTimersAsync();
    const failureResult = await failurePromise;

    expect(bodyOf(failureResult)).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(JSON.stringify(bodyOf(failureResult)).length).toBeLessThanOrEqual(8 * 1024);
  });
});

describe('run-dashboard-batch click-to-filter actions', () => {
  const filterActionBlocks = (xml: string): string[] =>
    [...xml.matchAll(/<action\b[^>]*>[\s\S]*?<\/action>/g)]
      .map((match) => match[0])
      .filter((block) => block.includes('tsc:tsl-filter'));
  const dashboardWarnings = (result: CallToolResult): string[] =>
    bodyOf(result).steps.find((step: any) => step.operation === 'dashboard').warnings ?? [];

  it('adds one Use as Filter action per chart sheet and none for KPI sheets', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'executive-summary',
      kpiWorksheetNames: ['Existing A'],
      executor: harness.executor,
    });

    expect(result.isError).toBe(false);
    const actions = filterActionBlocks(harness.posts[0]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toBe(
      "<action caption='Filter 1 (generated)' name='[Action1]'>" +
        "<activation auto-clear='true' type='on-select' />" +
        "<source type='sheet' worksheet='Existing B' dashboard='Executive Overview' />" +
        "<command command='tsc:tsl-filter'><param name='special-fields' value='all' />" +
        "<param name='target' value='Executive Overview' /></command></action>",
    );
    expect(harness.posts[0]).not.toContain("worksheet='Existing A'");
    expect(bodyOf(result).steps[0]).toMatchObject({
      filterActions: [
        { name: '[Action1]', caption: 'Filter 1 (generated)', sourceWorksheet: 'Existing B' },
      ],
    });
  });

  it('adds two uniquely captioned actions for an auto-grid of two charts', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      layoutType: 'auto-grid',
      executor: harness.executor,
    });

    const actions = filterActionBlocks(harness.posts[0]);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toContain("caption='Filter 1 (generated)'");
    expect(actions[1]).toContain("caption='Filter 2 (generated)'");
    expect(actions[1]).toContain("name='[Action2]'");
    expect(bodyOf(result).steps[0].filterActions).toHaveLength(2);
  });

  it('adds no actions when crossFilter is false', async () => {
    const harness = statefulExecutor();

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      crossFilter: false,
      executor: harness.executor,
    });

    expect(harness.posts[0]).not.toContain('<action');
    expect(bodyOf(result).steps[0]).not.toHaveProperty('filterActions');
  });

  it('adds no actions to a single-sheet dashboard', async () => {
    const harness = statefulExecutor();

    await callBatch([], { existingWorksheetNames: ['Existing A'], executor: harness.executor });

    expect(harness.posts[0]).not.toContain('<action');
  });

  it('publishes crossFilter as optional', async () => {
    const entry = await getDesktopToolListEntry(
      getRunDashboardBatchTool(new DesktopMcpServer(), { store: artifactStore([]) }),
    );
    expect(entry.inputSchema.properties).toHaveProperty('crossFilter');
    expect(entry.inputSchema.required).not.toContain('crossFilter');
  });

  describe('existing set and parameter actions', () => {
    const existing =
      "<actions><edit-group-action name='[Action7]' /><edit-parameter-action name='[Action8]' /></actions>";
    const initialXml = WORKBOOK_XML.replace('</datasources>', `</datasources>${existing}`);

    it('keeps them once, in family order, on an appending Desktop', async () => {
      const harness = statefulExecutor({ initialXml, appendActions: true });

      await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        executor: harness.executor,
      });

      expect(harness.posts).toHaveLength(1);
      expect(harness.posts[0]).not.toMatch(/\[Action7\]|\[Action8\]/);
      const live = harness.live();
      expect(liveActionNames(live)).toEqual(['[Action1]', '[Action2]', '[Action7]', '[Action8]']);
      expect(live.match(/<actions\b/g)).toHaveLength(1);
      expect(filterActionBlocks(live)).toHaveLength(2);
      expect(live.lastIndexOf('</action>')).toBeLessThan(live.indexOf('<edit-group-action'));
      expect(live.indexOf('<edit-group-action')).toBeLessThan(
        live.indexOf('<edit-parameter-action'),
      );
    });

    it('re-sends the full document on a replacing Desktop', async () => {
      const harness = statefulExecutor({ initialXml });

      await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        executor: harness.executor,
      });

      expect(harness.posts).toHaveLength(2);
      expect(harness.posts[0]).not.toMatch(/\[Action7\]|\[Action8\]/);
      const live = harness.live();
      expect(liveActionNames(live)).toEqual(['[Action1]', '[Action2]', '[Action7]', '[Action8]']);
      expect(live.match(/<actions\b/g)).toHaveLength(1);
      expect(live.lastIndexOf('</action>')).toBeLessThan(live.indexOf('<edit-group-action'));
      expect(live.indexOf('<edit-group-action')).toBeLessThan(
        live.indexOf('<edit-parameter-action'),
      );
    });
  });

  it('creates the actions block right after datasources when none exists', async () => {
    const harness = statefulExecutor();

    await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: harness.executor,
    });

    const xml = harness.posts[0];
    expect(xml.indexOf('</datasources><actions>')).toBeGreaterThan(-1);
    expect(xml.indexOf('</actions>')).toBeLessThan(xml.indexOf('<worksheets'));
  });

  it('does not duplicate a matching action when replacing a dashboard', async () => {
    const first = statefulExecutor();
    await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: first.executor,
    });
    const second = statefulExecutor({ initialXml: first.posts[0], appendActions: true });

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      replaceExisting: true,
      executor: second.executor,
    });

    expect(filterActionBlocks(second.posts[0])).toHaveLength(0);
    expect(liveActionCaptions(second.live())).toEqual([
      'Filter 1 (generated)',
      'Filter 2 (generated)',
    ]);
    expect(bodyOf(result).steps[0].filterActions).toHaveLength(2);
    expect(dashboardWarnings(result)).toEqual([]);
  });

  it('keeps the batch applied and warns when Desktop drops an action', async () => {
    const harness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<action\b[^>]*>[\s\S]*?<\/action>/, ''),
    });

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: harness.executor,
    });

    expect(bodyOf(result)).toMatchObject({ applied: true });
    expect(bodyOf(result).steps[0]).not.toHaveProperty('filterActions');
    expect(dashboardWarnings(result).join(' ')).toContain('Existing A');
    expect(dashboardWarnings(result).join(' ')).toContain("author-action mode:'filter'");
  });

  describe('stale generated filter actions on rebuild', () => {
    const USER_ACTIONS =
      "<action caption='Mine highlight' name='[Action90]'><activation type='on-select' /><source type='sheet' worksheet='Existing A' dashboard='Executive Overview' /><command command='tsc:tsl-highlight'><param name='target' value='Executive Overview' /></command></action>" +
      "<action caption='Mine filter' name='[Action91]'><activation auto-clear='true' type='on-select' /><source type='sheet' worksheet='Existing A' dashboard='Executive Overview' /><command command='tsc:tsl-filter'><param name='special-fields' value='all' /><param name='target' value='Executive Overview' /><param name='exclude' value='Existing B' /></command></action>";

    async function firstBuild(withUserActions = false): Promise<string> {
      const first = statefulExecutor();
      await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        executor: first.executor,
      });
      return withUserActions
        ? first.posts[0].replace('</actions>', `${USER_ACTIONS}</actions>`)
        : first.posts[0];
    }

    it('removes generated actions when rebuilt with crossFilter false', async () => {
      const second = statefulExecutor({ initialXml: await firstBuild() });

      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        replaceExisting: true,
        crossFilter: false,
        executor: second.executor,
      });

      expect(result.isError).toBe(false);
      expect(second.posts[0]).not.toContain('<action');
      expect(dashboardWarnings(result)).toEqual([]);
    });

    it('leaves the old action of a chart that became a KPI live and warns', async () => {
      const second = statefulExecutor({ initialXml: await firstBuild(), appendActions: true });

      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['Existing A'],
        replaceExisting: true,
        executor: second.executor,
      });

      expect(second.posts[0]).not.toContain('<action');
      expect(liveActionCaptions(second.live())).toEqual([
        'Filter 1 (generated)',
        'Filter 2 (generated)',
      ]);
      expect(dashboardWarnings(result)).toEqual([
        "Old filter actions are still live: 'Filter 1 (generated)'. This Desktop build cannot remove actions; remove them in Dashboard > Actions.",
      ]);
    });

    it('removes the action of a sheet dropped from the dashboard', async () => {
      const second = statefulExecutor({ initialXml: await firstBuild() });

      await callBatch([], {
        existingWorksheetNames: ['Existing A'],
        replaceExisting: true,
        executor: second.executor,
      });

      expect(second.posts[0]).not.toContain('<action');
    });

    it('warns when removed actions are still live after readback', async () => {
      const initialXml = await firstBuild();
      const stale = filterActionBlocks(initialXml)
        .find((block) => /worksheet=.Existing B./.test(block))!
        .replace('[Action2]', '[Action2_0123456789ABCDEF0123456789ABCDEF]');
      const second = statefulExecutor({
        initialXml,
        readbackTransform: (xml) =>
          xml.replace('<worksheets', `<actions>${stale}</actions><worksheets`),
      });

      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A'],
        replaceExisting: true,
        executor: second.executor,
      });

      expect(bodyOf(result)).toMatchObject({ applied: true });
      expect(dashboardWarnings(result)).toEqual([
        "Old filter actions are still live: 'Filter 2 (generated)'. This Desktop build cannot remove actions; remove them in Dashboard > Actions.",
      ]);
    });

    it('keeps a user action with the generated shape but a user caption', async () => {
      const initialXml = (await firstBuild()).replace(
        /caption=(["'])Filter 1 \(generated\)\1/,
        "caption='Region filter'",
      );
      const second = statefulExecutor({ initialXml, appendActions: true });

      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        replaceExisting: true,
        crossFilter: false,
        executor: second.executor,
      });

      expect(second.posts[0]).not.toContain('<action');
      expect(liveActionCaptions(second.live())).toEqual(['Region filter', 'Filter 2 (generated)']);
      expect(dashboardWarnings(result)).toEqual([
        "Old filter actions are still live: 'Filter 2 (generated)'. This Desktop build cannot remove actions; remove them in Dashboard > Actions.",
      ]);
    });

    it('keeps sourceWorksheet and drops names when the receipt is large', async () => {
      const names = Array.from({ length: 6 }, (_, i) => `Chart ${i}`);
      const harness = statefulExecutor({
        initialXml: renderedWorkbook(names),
        readbackTransform: (xml) =>
          xml.replace(
            /name=(["'])\[Action(\d+)\]\1/g,
            "name='[Action$2_0123456789ABCDEF0123456789ABCDEF]'",
          ),
      });

      const result = await callBatch([], {
        existingWorksheetNames: names,
        executor: harness.executor,
      });

      const receipt = bodyOf(result).steps[0].filterActions;
      expect(receipt).toHaveLength(6);
      expect(receipt[0]).toEqual({ caption: 'Filter 1 (generated)', sourceWorksheet: 'Chart 0' });
    });

    it('leaves user-authored highlight and non-matching filter actions alone', async () => {
      const second = statefulExecutor({
        initialXml: await firstBuild(true),
        appendActions: true,
      });

      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        replaceExisting: true,
        crossFilter: false,
        executor: second.executor,
      });

      expect(second.posts[0]).not.toContain('<action');
      expect(liveActionCaptions(second.live())).toEqual([
        'Filter 1 (generated)',
        'Filter 2 (generated)',
        'Mine highlight',
        'Mine filter',
      ]);
      expect(dashboardWarnings(result)).toEqual([
        "Old filter actions are still live: 'Filter 1 (generated)', 'Filter 2 (generated)'. This Desktop build cannot remove actions; remove them in Dashboard > Actions.",
      ]);
    });
  });

  describe.each([
    ['append', true],
    ['replace', false],
  ])('user-targeted filter actions on rebuild (%s Desktop)', (_label, appendActions) => {
    const rebuild = async (
      initialXml: string,
    ): Promise<{ live: string; result: CallToolResult }> => {
      const second = statefulExecutor({ initialXml, appendActions });
      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        replaceExisting: true,
        executor: second.executor,
      });
      return { live: second.live(), result };
    };
    const built = async (): Promise<string> => {
      const first = statefulExecutor();
      await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        executor: first.executor,
      });
      return first.posts[0];
    };
    const actionFor = (xml: string, sheet: string): string =>
      filterActionBlocks(xml).find((block) => new RegExp(`worksheet=.${sheet}.`).test(block))!;
    const fromSheet = (xml: string, sheet: string): string[] =>
      filterActionBlocks(xml).filter((block) => new RegExp(`worksheet=.${sheet}.`).test(block));

    it('adds nothing for a sheet whose generated action the user edited', async () => {
      const initial = await built();
      const a = actionFor(initial, 'Existing A');
      const edited = a.replace(
        '</command>',
        "<param name='exclude' value='Existing B' /></command>",
      );
      const { live, result } = await rebuild(initial.replace(a, edited));

      expect(fromSheet(live, 'Existing A')).toHaveLength(1);
      expect(fromSheet(live, 'Existing A')[0]).toMatch(/name=.exclude./);
      expect(fromSheet(live, 'Existing B')).toHaveLength(1);
      expect(dashboardWarnings(result)).toEqual([]);
    });

    it('still adds the missing action for the other sheet', async () => {
      const initial = await built();
      const a = actionFor(initial, 'Existing A');
      const b = actionFor(initial, 'Existing B');
      const edited = a.replace(
        '</command>',
        "<param name='exclude' value='Existing B' /></command>",
      );
      const { live, result } = await rebuild(initial.replace(a, edited).replace(b, ''));

      expect(fromSheet(live, 'Existing A')).toHaveLength(1);
      expect(fromSheet(live, 'Existing B')).toHaveLength(1);
      expect(liveActionCaptions(live)).toEqual(['Filter 1 (generated)', 'Filter 2 (generated)']);
      expect(dashboardWarnings(result).join(' ')).not.toContain('did not persist');
    });

    it('adds nothing for a sheet with a user-made filter action', async () => {
      const initial = await built();
      const a = actionFor(initial, 'Existing A');
      const mine = a
        .replace(/caption=(["'])Filter 1 \(generated\)\1/, "caption='Region filter'")
        .replace('</command>', "<param name='exclude' value='Existing B' /></command>");
      const { live, result } = await rebuild(initial.replace(a, mine));

      expect(fromSheet(live, 'Existing A')).toHaveLength(1);
      expect(liveActionCaptions(live)).toEqual(['Region filter', 'Filter 2 (generated)']);
      expect(dashboardWarnings(result)).toEqual([]);
    });

    it('keeps an exact generated action as applied', async () => {
      const { live, result } = await rebuild(await built());

      expect(liveActionCaptions(live)).toEqual(['Filter 1 (generated)', 'Filter 2 (generated)']);
      expect(bodyOf(result).steps[0].filterActions).toHaveLength(2);
      expect(dashboardWarnings(result)).toEqual([]);
    });
  });

  it('does not reuse a stale action name or caption for a new sheet', async () => {
    const names = ['Existing A', 'Existing B', 'Existing C'];
    const first = statefulExecutor({ initialXml: renderedWorkbook(names) });
    await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: first.executor,
    });
    const second = statefulExecutor({ initialXml: first.posts[0], appendActions: true });

    await callBatch([], {
      existingWorksheetNames: ['Existing C', 'Existing B'],
      replaceExisting: true,
      executor: second.executor,
    });

    const live = second.live();
    expect(liveActionCaptions(live)).toEqual([
      'Filter 1 (generated)',
      'Filter 2 (generated)',
      'Filter 3 (generated)',
    ]);
    expect(liveActionNames(live)).toEqual(['[Action1]', '[Action2]', '[Action3]']);
  });

  it('puts the full dashboard name in the recovery call', async () => {
    const name = `Executive's ${'very long dashboard name '.repeat(3)}`.trim().slice(0, 60);
    const harness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<actions>[\s\S]*?<\/actions>/, ''),
    });

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      dashboardName: name,
      executor: harness.executor,
    });

    expect(name).toHaveLength(60);
    expect(dashboardWarnings(result)[0]).toContain(
      `sourceDashboard:${JSON.stringify(name)} sourceWorksheet:'<sheet>' targetSheet:${JSON.stringify(name)}`,
    );
  });

  describe('rounded-bar sheets', () => {
    const rounded = (xml: string, sheet: string): string =>
      xml.replace(
        new RegExp(`(<worksheet name="${sheet}">)`),
        '$1<datasource-dependencies datasource="d"><column datatype="real" name="[__tmcp_round_0123456789ab_x]" role="measure" type="quantitative"/></datasource-dependencies>',
      );

    it('adds no filter actions and warns, even with crossFilter true', async () => {
      const harness = statefulExecutor({ initialXml: rounded(WORKBOOK_XML, 'Existing B') });

      const result = await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        crossFilter: true,
        executor: harness.executor,
      });

      expect(bodyOf(result)).toMatchObject({ applied: true });
      expect(harness.posts[0]).not.toContain('tsc:tsl-filter');
      expect(dashboardWarnings(result)).toEqual([
        "Skipped filter actions on 'Executive Overview': rounded bars on 'Existing B' disappear when other sheets filter them.",
      ]);
    });

    it('removes prior generated actions when a sheet became rounded', async () => {
      const first = statefulExecutor();
      await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        executor: first.executor,
      });
      const second = statefulExecutor({ initialXml: rounded(first.posts[0], 'Existing A') });

      await callBatch([], {
        existingWorksheetNames: ['Existing A', 'Existing B'],
        replaceExisting: true,
        executor: second.executor,
      });

      expect(second.posts[0]).not.toContain('tsc:tsl-filter');
    });
  });

  it('gives a complete author-action recovery call when actions did not persist', async () => {
    const harness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/<action\b[^>]*>[\s\S]*?<\/action>/, ''),
    });

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: harness.executor,
    });

    expect(dashboardWarnings(result)).toEqual([
      "Dashboard filter actions did not persist for: Existing A. The dashboard is applied. Check Dashboard > Actions before retrying, because some Desktop builds rename new actions and author-action can report a miss when one landed. To add one, call author-action mode:'filter' sourceDashboard:\"Executive Overview\" sourceWorksheet:'<sheet>' targetSheet:\"Executive Overview\" caption:'Filter N (generated)' clearSelection:'show-all', with N unique.",
    ]);
  });

  it('bounds the did-not-persist warning for many long sheet names', async () => {
    const names = Array.from({ length: 7 }, (_, i) => `${'Long sheet name '.repeat(5)}${i}`);
    const harness = statefulExecutor({
      initialXml: renderedWorkbook(names),
      readbackTransform: (xml) => xml.replace(/<actions>[\s\S]*?<\/actions>/, ''),
    });

    const result = await callBatch([], {
      existingWorksheetNames: names,
      executor: harness.executor,
    });

    const warning = dashboardWarnings(result)[0];
    expect(warning).toContain('and 2 more');
    expect(warning.length).toBeLessThan(700);
  });

  it('keeps the batch applied and warns when Desktop appends duplicate actions', async () => {
    const harness = statefulExecutor({
      readbackTransform: (xml) => xml.replace(/(<action\b[^>]*>[\s\S]*?<\/action>)/, '$1$1'),
    });

    const result = await callBatch([], {
      existingWorksheetNames: ['Existing A', 'Existing B'],
      executor: harness.executor,
    });

    expect(bodyOf(result)).toMatchObject({ applied: true });
    expect(dashboardWarnings(result)).toEqual([
      'This Desktop build adds actions instead of replacing them, so the workbook may hold duplicate actions. Remove the copies in Dashboard > Actions.',
    ]);
  });
});

async function callBatch(
  artifactIds: string[],
  options: {
    store?: TemplateArtifactStore;
    signal?: AbortSignal;
    executor?: ExternalApiToolExecutor;
    existingWorksheetNames?: string[];
    kpiWorksheetNames?: string[];
    layoutType?: 'auto-grid' | 'rows' | 'columns' | 'executive-summary';
    gridColumns?: number;
    crossFilter?: boolean;
    replaceExisting?: boolean;
    dashboardName?: string;
  } = {},
): Promise<CallToolResult> {
  const tool = getRunDashboardBatchTool(new DesktopMcpServer(), {
    store: options.store ?? artifactStore(artifactIds),
  });
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '12345',
      artifactIds,
      ...BATCH,
      ...(options.dashboardName !== undefined
        ? { dashboardName: options.dashboardName, title: options.dashboardName }
        : {}),
      gridColumns: options.gridColumns,
      layoutType: options.layoutType ?? BATCH.layoutType,
      kpiWorksheetNames: options.kpiWorksheetNames,
      replaceExisting: options.replaceExisting ?? false,
      crossFilter: options.crossFilter,
      ...(options.existingWorksheetNames !== undefined
        ? { existingWorksheetNames: options.existingWorksheetNames }
        : {}),
    },
    {
      ...getMockRequestHandlerExtra(),
      signal: options.signal ?? new AbortController().signal,
      getExecutor: vi.fn().mockResolvedValue(options.executor ?? statefulExecutor().executor),
    },
  );
}

const ACTION_ELEMENT =
  /<(action|edit-group-action|edit-parameter-action)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g;
const FAMILY = ['action', 'edit-group-action', 'edit-parameter-action'];

function actionElements(xml: string): string[] {
  const block = xml.match(/<actions>([\s\S]*?)<\/actions>/)?.[1] ?? '';
  return [...block.matchAll(ACTION_ELEMENT)].map((match) => match[0]);
}

function appendLiveActions(liveXml: string, postedXml: string): string {
  const family = (element: string): number => FAMILY.indexOf(element.match(/^<([\w-]+)/)![1]);
  const all = [...actionElements(liveXml), ...actionElements(postedXml)].sort(
    (a, b) => family(a) - family(b),
  );
  const without = postedXml.replace(/<actions>[\s\S]*?<\/actions>/, '');
  return all.length === 0
    ? without
    : without.replace('<worksheets', `<actions>${all.join('')}</actions><worksheets`);
}

// Names of every top-level action in document order.
function liveActionNames(xml: string): string[] {
  return actionElements(xml).map((element) => element.match(/\bname=["']([^"']+)["']/)![1]);
}

function liveActionCaptions(xml: string): string[] {
  return actionElements(xml).map((element) => element.match(/\bcaption=["']([^"']+)["']/)![1]);
}

function statefulExecutor({
  initialXml = WORKBOOK_XML,
  failAfterDispatch = false,
  driftBeforeApply = false,
  readbackTransform,
  appendActions = false,
}: {
  initialXml?: string;
  failAfterDispatch?: boolean;
  driftBeforeApply?: boolean;
  readbackTransform?: (xml: string) => string;
  // Desktop 0.2.21: a POST keeps every live action and adds the posted ones.
  appendActions?: boolean;
} = {}): { executor: ExternalApiToolExecutor; posts: string[]; live: () => string } {
  let current = initialXml;
  let readCount = 0;
  const posts: string[] = [];
  const executor = {
    getWorkbookDocument: vi.fn(async () => {
      const xml =
        driftBeforeApply && readCount++ > 0
          ? current.replace('<workbook>', '<workbook changed="true">')
          : posts.length > 0 && readbackTransform
            ? readbackTransform(current)
            : current;
      return Ok({
        xml,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
        instanceId: 'inst-live',
      });
    }),
    applyWorkbookDocument: vi.fn(
      async (xml: string, _signal: AbortSignal, options?: ApplyWorkbookDocumentOptions) => {
        options?.onDispatch?.();
        posts.push(xml);
        if (failAfterDispatch) {
          return Err({ type: 'command-timed-out' as const, error: 'timed out' });
        }
        current = appendActions ? appendLiveActions(current, xml) : xml;
        return Ok({ command_id: 'apply-1', status: 'completed' as const, submitted_at: 'now' });
      },
    ),
    executeCommand: vi.fn(async () =>
      Ok({ command_id: 'goto-1', status: 'completed' as const, submitted_at: 'now' }),
    ),
  } as unknown as ExternalApiToolExecutor;
  return { executor, posts, live: () => current };
}

function artifactStore(
  artifactIds: string[],
  options: {
    sessionId?: string;
    instanceId?: string;
    titles?: Record<string, string>;
    worksheetXmls?: Record<string, string>;
  } = {},
): TemplateArtifactStore {
  const store = new TemplateArtifactStore();
  for (const artifactId of artifactIds) {
    const title = options.titles?.[artifactId] ?? artifactTitle(artifactId);
    const worksheetXml =
      options.worksheetXmls?.[artifactId] ?? `<worksheet name="${title}"><table/></worksheet>`;
    store.put({
      id: artifactId,
      sessionId: options.sessionId ?? '12345',
      instanceId: options.instanceId ?? 'inst-live',
      templateName: 'test-template',
      templateSourceHash: 'source-hash',
      title,
      datasource: 'target.ds',
      fieldMapping: {},
      worksheetXml,
      windowXml: `<window class="worksheet" name="${title}"/>`,
      targetState: captureTargetWorksheetState(WORKBOOK_XML, title, worksheetXml),
    } satisfies TemplateWorksheetArtifact);
  }
  return store;
}

function artifactTitle(artifactId: string): string {
  if (artifactId === 'a1') return 'New A';
  if (artifactId === 'a2') return 'New B';
  return `New ${artifactId}`;
}

// Non-empty `<rows>` text is enough for worksheetRenderState's `worksheetDocumentState` to
// classify a `<table>` as rendered rather than blank (mirrors the fixture fix in
// composeDashboardCore.test.ts's PRISTINE). These names represent worksheets meant to already be
// live and rendered in the workbook; tests that need an unrendered worksheet build their own
// blank `<table/>` fixture directly rather than going through this helper.
function renderedWorkbook(names: string[]): string {
  return `<?xml version="1.0"?><workbook><datasources><datasource name="federated.x"/></datasources><worksheets>${names
    .map((name) => `<worksheet name="${name}"><table><rows>${name}</rows></table></worksheet>`)
    .join('')}</worksheets><windows>${names
    .map((name) => `<window class="worksheet" name="${name}"/>`)
    .join('')}</windows></workbook>`;
}

function rankedWorkbook(): string {
  const column = '[Sample - Superstore].[none:Product Name:nk]';
  const level = '[none:Product Name:nk]';
  const sales = '[Sample - Superstore].[sum:Sales:qk]';
  return `<?xml version="1.0"?><workbook><datasources><datasource name="federated.x"/></datasources><worksheets>
    <worksheet name="Top Products"><table><view>
      <datasource-dependencies datasource="Sample - Superstore">
        <column-instance column="[Product Name]" derivation="None" name="${level}" pivot="key" type="nominal"/>
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
      </datasource-dependencies>
      <filter class="categorical" column="${column}">
        <groupfilter function="end" count="10" end="top" units="records">
          <groupfilter function="order" direction="DESC" expression="SUM([Sales])">
            <groupfilter function="level-members" level="${level}"/>
          </groupfilter>
        </groupfilter>
      </filter>
      <computed-sort column="${column}" direction="DESC" using="${sales}"/>
      <slices><column>${column}</column></slices>
    </view><panes><pane><mark class="Bar"/></pane></panes>
    <rows>${column}</rows><cols>${sales}</cols></table></worksheet>
  </worksheets><windows><window class="worksheet" name="Top Products"/></windows></workbook>`;
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}
