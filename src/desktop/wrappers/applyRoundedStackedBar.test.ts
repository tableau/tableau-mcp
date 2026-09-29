import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import type { WorkbookDocument } from '../externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import { planRoundStackedBar, type RoundStackedBarPlan } from '../refine/roundStackedBar.js';
import * as validationRegistry from '../validation/registry.js';
import { applyRoundedStackedBar } from './applyRoundedStackedBar.js';

const WORKSHEET_ID = '{B157D4FA-12A0-495E-BEC4-3572B3567648}';
const SIGNAL = new AbortController().signal;
const NO_FOCUS = { navigate: 'none', reason: 'no-live-write' } as const;

function sourceWorksheet(): string {
  return `<worksheet name='Orders' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <table>
    <view>
      <datasources><datasource caption='Friendly Sales' name='Sales' /></datasources>
      <datasource-dependencies datasource='Sales'>
        <column caption='Category' datatype='string' name='[Category]' role='dimension' type='nominal' />
        <column caption='Segment' datatype='string' name='[Segment]' role='dimension' type='nominal' />
        <column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />
        <column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' />
        <column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />
        <column-instance column='[Segment]' derivation='None' name='[none:Segment:nk]' pivot='key' type='nominal' />
        <column-instance column='[Profit]' derivation='Sum' name='[sum:Profit:qk]' pivot='key' type='quantitative' />
        <column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />
      </datasource-dependencies>
      <filter class='categorical' column='[Sales].[none:Region:nk]'><groupfilter function='union' user:ui-enumeration='inclusive'><groupfilter function='member' level='[none:Region:nk]' member='&quot;West&quot;' /></groupfilter></filter>
      <computed-sort column='[Sales].[none:Category:nk]' direction='DESC' using='[Sales].[sum:Profit:qk]' />
      <slices><column>[Sales].[none:Region:nk]</column></slices>
      <aggregation value='true' />
    </view>
    <style>
      <style-rule element='axis'><format attr='line-visibility' value='off' /><format attr='title' class='0' field='[Sales].[sum:Profit:qk]' scope='rows' value='Profit (USD)' /></style-rule>
      <style-rule element='mark'><encoding attr='color' field='[Sales].[none:Segment:nk]' palette='Safe Palette' type='palette'><map to='#123456'><bucket>&quot;Consumer&quot;</bucket></map></encoding></style-rule>
      <style-rule element='zeroline'><format attr='line-visibility' value='off' /></style-rule>
      <style-rule element='worksheet'><format attr='display-field-labels' scope='rows' value='false' /></style-rule>
    </style>
    <panes><pane><view><breakdown value='auto' /></view><mark class='Bar' /><encodings><color column='[Sales].[none:Segment:nk]' /></encodings></pane></panes>
    <rows>[Sales].[sum:Profit:qk]</rows><cols>[Sales].[none:Category:nk]</cols>
  </table>
  <simple-id uuid='${WORKSHEET_ID}' />
</worksheet>`;
}

function simpleSourceWorksheet(): string {
  return sourceWorksheet()
    .replace(
      "        <column caption='Segment' datatype='string' name='[Segment]' role='dimension' type='nominal' />\n",
      '',
    )
    .replace(
      "        <column-instance column='[Segment]' derivation='None' name='[none:Segment:nk]' pivot='key' type='nominal' />\n",
      '',
    )
    .replace(
      "      <style-rule element='mark'><encoding attr='color' field='[Sales].[none:Segment:nk]' palette='Safe Palette' type='palette'><map to='#123456'><bucket>&quot;Consumer&quot;</bucket></map></encoding></style-rule>\n",
      '',
    )
    .replace(
      "<encodings><color column='[Sales].[none:Segment:nk]' /></encodings>",
      '<encodings />',
    );
}

function sourceWorksheetWithDisplayCaptions(): string {
  return sourceWorksheet()
    .replace("caption='Category' datatype", "caption='Product Family' datatype")
    .replace("caption='Segment' datatype", "caption='Customer Type' datatype")
    .replace("caption='Profit' datatype", "caption='Net Margin' datatype")
    .replace("caption='Region' datatype", "caption='Sales Territory' datatype");
}

function blankWorksheet(): string {
  return `<worksheet name='Orders'>
  <table>
    <view>
      <datasources><datasource caption='Friendly Sales' name='Sales' /></datasources>
      <datasource-dependencies datasource='Sales' />
      <aggregation value='true' />
    </view>
    <style />
    <panes><pane><mark class='Automatic' /></pane></panes>
    <rows /><cols />
  </table>
  <simple-id uuid='${WORKSHEET_ID}' />
</worksheet>`;
}

type TableData = { columns: Array<{ name: string }>; rows: unknown[][] };

function plan(source = sourceWorksheet()): RoundStackedBarPlan {
  const planned = planRoundStackedBar(source, { preset: 'subtle' });
  expect(planned.ok).toBe(true);
  if (!planned.ok) throw new Error(planned.reason);
  return planned;
}

const sourceGroups = [
  ['Alpha', 'Consumer', 10],
  ['Alpha', 'Corporate', 20],
  ['Alpha', 'Home Office', 30],
  ['Beta', 'Consumer', -4],
  ['Beta', 'Home Office', -6],
] as const;

function baselineSummary(): TableData {
  return {
    columns: [
      { name: 'SUM(Profit)' },
      { name: 'Tooltip Only' },
      { name: 'Segment' },
      { name: 'Category' },
    ],
    rows: sourceGroups.map(([category, segment, value]) => [value, 'extra', segment, category]),
  };
}

function underlyingRows(distinct = true): TableData {
  return {
    columns: [
      { name: '[Friendly Sales].[Segment]' },
      { name: '[Friendly Sales].[Region]' },
      { name: '[Friendly Sales].[Profit]' },
      { name: '[Friendly Sales].[Category]' },
    ],
    rows: sourceGroups.flatMap(([category, segment, value]) =>
      distinct
        ? [
            [segment, 'West', value / 3, category],
            [segment, 'West', (value * 2) / 3, category],
          ]
        : [
            [segment, 'West', value, category],
            [segment, 'West', value, category],
          ],
    ),
  };
}

type Interval = {
  category: string;
  segment: string;
  low: number;
  high: number;
  roundTop?: boolean;
  roundBottom?: boolean;
};

function polygonRows(
  interval: Interval,
  categorySpan = interval.category === 'Alpha' ? 60 : 10,
): unknown[][] {
  const radius = Math.min((interval.high - interval.low) / 2, 0.02 * categorySpan);
  const topY = interval.roundTop ? radius : 0;
  const bottomY = interval.roundBottom ? radius : 0;
  const topX = interval.roundTop ? 0.06 : 0;
  const bottomX = interval.roundBottom ? 0.06 : 0;
  const x = [
    -0.35,
    -0.35,
    -0.35 + 0.292893 * topX,
    -0.35 + topX,
    0.35 - topX,
    0.35 - 0.292893 * topX,
    0.35,
    0.35,
    0.35 - 0.292893 * bottomX,
    0.35 - bottomX,
    -0.35 + bottomX,
    -0.35 + 0.292893 * bottomX,
  ];
  const y = [
    interval.low + bottomY,
    interval.high - topY,
    interval.high - 0.292893 * topY,
    interval.high,
    interval.high,
    interval.high - 0.292893 * topY,
    interval.high - topY,
    interval.low + bottomY,
    interval.low + 0.292893 * bottomY,
    interval.low,
    interval.low,
    interval.low + 0.292893 * bottomY,
  ];
  return x.map((vertexX, frame) => [
    vertexX,
    interval.segment,
    frame + 1,
    interval.category,
    y[frame],
    frame,
    'tooltip',
  ]);
}

function polygonSummary(): TableData {
  const intervals: Interval[] = [
    { category: 'Alpha', segment: 'Home Office', low: 0, high: 30 },
    { category: 'Alpha', segment: 'Corporate', low: 30, high: 50 },
    { category: 'Alpha', segment: 'Consumer', low: 50, high: 60, roundTop: true },
    { category: 'Beta', segment: 'Home Office', low: -6, high: 0 },
    { category: 'Beta', segment: 'Consumer', low: -10, high: -6, roundBottom: true },
  ];
  return {
    columns: [
      { name: 'AGG(TMCP rounded x)' },
      { name: 'Segment' },
      { name: 'AGG(TMCP rounded path)' },
      { name: 'Category' },
      { name: 'AGG(TMCP rounded y)' },
      { name: 'TMCP rounded path frame' },
      { name: 'Tooltip Only' },
    ],
    rows: intervals.flatMap((interval) => polygonRows(interval)).reverse(),
  };
}

function simpleBaselineSummary(): TableData {
  return {
    columns: [{ name: 'Tooltip Only' }, { name: 'Category' }, { name: 'SUM(Profit)' }],
    rows: [
      ['extra', 'Alpha', 12],
      ['extra', 'Beta', -8],
    ],
  };
}

function simpleUnderlyingRows(): TableData {
  return {
    columns: [
      { name: '[Friendly Sales].[Profit]' },
      { name: '[Friendly Sales].[Category]' },
      { name: '[Friendly Sales].[Region]' },
    ],
    rows: [
      [4, 'Alpha', 'West'],
      [8, 'Alpha', 'West'],
      [-3, 'Beta', 'West'],
      [-5, 'Beta', 'West'],
    ],
  };
}

function simplePolygonSummary(): TableData {
  const intervals: Interval[] = [
    { category: 'Alpha', segment: '', low: 0, high: 12, roundTop: true },
    { category: 'Beta', segment: '', low: -8, high: 0, roundBottom: true },
  ];
  return {
    columns: [
      { name: 'AGG(TMCP rounded path)' },
      { name: 'Category' },
      { name: 'AGG(TMCP rounded y)' },
      { name: 'TMCP rounded path frame' },
      { name: 'AGG(TMCP rounded x)' },
    ],
    rows: intervals
      .flatMap((interval) =>
        polygonRows(interval, Math.abs(interval.high - interval.low)).map((row) => [
          row[2],
          row[3],
          row[4],
          row[5],
          row[0],
        ]),
      )
      .reverse(),
  };
}

function helperDefinitions(xml: string): string {
  return [...xml.matchAll(/<column\b(?=[^>]*\bname='\[__tmcp_round_[^']+\]')[\s\S]*?<\/column>/g)]
    .map(([definition]) => definition)
    .join('');
}

function workbook(sheet: string, helpers = ''): string {
  return `<workbook>
    <datasources><datasource caption='Friendly Sales' name='Sales'><column name='[Existing]' />${helpers}</datasource></datasources>
    <worksheets>${sheet}</worksheets>
    <dashboards><dashboard name='Dashboard'><zones><zone id='4' name='Orders' /></zones><simple-id uuid='{DASHBOARD}' /></dashboard></dashboards>
    <windows><window class='worksheet' name='Orders'><simple-id uuid='{WINDOW}' /></window><window class='dashboard' name='Dashboard'><simple-id uuid='{DASHBOARD-WINDOW}' /></window></windows>
  </workbook>`;
}

function document(xml: string): WorkbookDocument {
  return { xml, applicationVersion: undefined, xsdPayloadVersion: undefined };
}

function successfulExecutor(
  options: { distinctSeeds?: boolean; sourceWorksheetXml?: string } = {},
): {
  planned: RoundStackedBarPlan;
  executor: ExternalApiToolExecutor;
  applyWorksheetDocument: ReturnType<typeof vi.fn>;
  getWorksheetDocument: ReturnType<typeof vi.fn>;
  getWorksheetSummaryData: ReturnType<typeof vi.fn>;
  getWorksheetUnderlyingData: ReturnType<typeof vi.fn>;
} {
  const source = options.sourceWorksheetXml ?? sourceWorksheet();
  const planned = plan(source);
  const intended = planned.xml;
  const applyWorksheetDocument = vi
    .fn()
    .mockResolvedValue(Ok({ command_id: 'apply', status: 'completed', submitted_at: '' }));
  const getWorksheetDocument = vi
    .fn()
    .mockResolvedValueOnce(Ok(document(source)))
    .mockResolvedValueOnce(Ok(document(source)))
    .mockResolvedValue(Ok(document(intended)));
  const getWorksheetSummaryData = vi
    .fn()
    .mockResolvedValueOnce(Ok(baselineSummary()))
    .mockResolvedValue(Ok(polygonSummary()));
  const getWorksheetUnderlyingData = vi
    .fn()
    .mockResolvedValue(Ok(underlyingRows(options.distinctSeeds ?? true)));
  const executor = makeExecutorMock({
    getWorksheetDocument,
    getWorkbookDocument: vi
      .fn()
      .mockResolvedValueOnce(Ok(document(workbook(source))))
      .mockResolvedValue(Ok(document(workbook(intended, helperDefinitions(intended))))),
    getWorksheetSummaryData,
    listWorksheetLogicalTables: vi
      .fn()
      .mockResolvedValue(Ok({ tables: [{ id: 'orders', caption: 'Orders' }] })),
    getWorksheetUnderlyingData,
    listWorksheets: vi
      .fn()
      .mockResolvedValue(Ok({ worksheets: [{ id: WORKSHEET_ID, name: 'Orders' }] })),
    applyWorksheetDocument,
  });
  return {
    planned,
    executor,
    applyWorksheetDocument,
    getWorksheetDocument,
    getWorksheetSummaryData,
    getWorksheetUnderlyingData,
  };
}

function successfulSimpleExecutor(): ReturnType<typeof successfulExecutor> {
  const source = simpleSourceWorksheet();
  const harness = successfulExecutor({ sourceWorksheetXml: source });
  harness.getWorksheetSummaryData
    .mockReset()
    .mockResolvedValueOnce(Ok(simpleBaselineSummary()))
    .mockResolvedValue(Ok(simplePolygonSummary()));
  harness.getWorksheetUnderlyingData.mockReset().mockResolvedValue(Ok(simpleUnderlyingRows()));
  return harness;
}

describe('applyRoundedStackedBar', () => {
  beforeEach(() => {
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails before mutation when the worksheet changed after planning', async () => {
    const planned = plan();
    const applyWorksheetDocument = vi.fn();
    const executor = makeExecutorMock({
      getWorksheetDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: sourceWorksheet().replace("value='false'", "value='true'"),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyWorksheetDocument,
    });

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: planned.xml,
      contract: planned.semanticContract,
      focus: NO_FOCUS,
      executor,
      signal: SIGNAL,
    });

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'source-drift',
    });
    expect(applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('preflights live data, posts by stable id, and strictly verifies the landed Polygon', async () => {
    const harness = successfulExecutor();

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome, JSON.stringify(outcome)).toMatchObject({
      state: 'applied',
      mutation: 'sent',
      retrySafe: false,
      worksheet: { id: WORKSHEET_ID, name: 'Orders' },
    });
    expect(harness.applyWorksheetDocument).toHaveBeenCalledWith(
      WORKSHEET_ID,
      harness.planned.xml,
      SIGNAL,
    );
    expect(harness.getWorksheetSummaryData).toHaveBeenNthCalledWith(
      1,
      WORKSHEET_ID,
      { maxRows: 1000, ignoreAliases: true, ignoreSelection: true },
      SIGNAL,
    );
    expect(harness.getWorksheetUnderlyingData).toHaveBeenCalledWith(
      WORKSHEET_ID,
      'orders',
      {
        maxRows: 10_000,
        ignoreAliases: true,
        ignoreSelection: true,
        columnsToIncludeByFieldName: [
          '[Friendly Sales].[Category]',
          '[Friendly Sales].[Segment]',
          '[Friendly Sales].[Profit]',
          '[Friendly Sales].[Region]',
        ],
      },
      SIGNAL,
    );
  });

  it('applies a simple bar without requesting a Segment projection', async () => {
    const harness = successfulSimpleExecutor();
    const source = simpleSourceWorksheet();

    expect(source).toContain("<view><breakdown value='auto' /></view>");
    expect(source).not.toContain("column='[Sales].[none:Segment:nk]'");

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: source,
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome, JSON.stringify(outcome)).toMatchObject({ state: 'applied', mutation: 'sent' });
    expect(harness.getWorksheetUnderlyingData).toHaveBeenCalledWith(
      WORKSHEET_ID,
      'orders',
      expect.objectContaining({
        columnsToIncludeByFieldName: [
          '[Friendly Sales].[Category]',
          '[Friendly Sales].[Profit]',
          '[Friendly Sales].[Region]',
        ],
      }),
      SIGNAL,
    );
  });

  it('uses a generic refusal when the logical table contract is not satisfied', async () => {
    const harness = successfulSimpleExecutor();
    vi.mocked(harness.executor.listWorksheetLogicalTables).mockResolvedValue(
      Ok({ tables: [{ id: undefined, caption: 'Orders' }] }),
    );

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: simpleSourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({ state: 'failed', stage: 'logical-table-preflight' });
    if (outcome.state !== 'applied') expect(outcome.message).toMatch(/^Rounded bars require/);
  });

  it('projects source columns when display captions differ and reaches apply', async () => {
    const source = sourceWorksheetWithDisplayCaptions();
    const harness = successfulExecutor({ sourceWorksheetXml: source });

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: source,
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome, JSON.stringify(outcome)).toMatchObject({ state: 'applied', mutation: 'sent' });
    expect(harness.getWorksheetUnderlyingData).toHaveBeenCalledWith(
      WORKSHEET_ID,
      'orders',
      expect.objectContaining({
        columnsToIncludeByFieldName: [
          '[Friendly Sales].[Category]',
          '[Friendly Sales].[Segment]',
          '[Friendly Sales].[Profit]',
          '[Friendly Sales].[Region]',
        ],
      }),
      SIGNAL,
    );
    expect(harness.applyWorksheetDocument).toHaveBeenCalledOnce();
  });

  it('fails before mutation when any visible group lacks two distinct raw seed values', async () => {
    const harness = successfulExecutor({ distinctSeeds: false });

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'seed-preflight',
    });
    if (outcome.state !== 'applied') expect(outcome.message).toContain('two are required');
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('fails before mutation unless the worksheet exposes exactly one logical table', async () => {
    const harness = successfulExecutor();
    vi.mocked(harness.executor.listWorksheetLogicalTables).mockResolvedValue(
      Ok({
        tables: [
          { id: 'orders', caption: 'Orders' },
          { id: 'returns', caption: 'Returns' },
        ],
      }),
    );

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'logical-table-preflight',
    });
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'target datasource',
      sourceWorkbook: (helperPrefix: string) =>
        workbook(sourceWorksheet()).replace(
          "<column name='[Existing]' />",
          `<column name='[Existing]' /><column name='[${helperPrefix}collision]' />`,
        ),
    },
    {
      label: 'another datasource',
      sourceWorkbook: (helperPrefix: string) =>
        workbook(sourceWorksheet()).replace(
          '</datasources>',
          `<datasource name='Other'><column name='[${helperPrefix}collision]' /></datasource></datasources>`,
        ),
    },
  ])(
    'fails before mutation when $label already contains the planned helper prefix',
    async ({ sourceWorkbook }) => {
      const harness = successfulExecutor();
      vi.mocked(harness.executor.getWorkbookDocument)
        .mockReset()
        .mockResolvedValue(
          Ok(document(sourceWorkbook(harness.planned.semanticContract.helperPrefix))),
        );

      const outcome = await applyRoundedStackedBar({
        sourceWorksheetXml: sourceWorksheet(),
        intendedWorksheetXml: harness.planned.xml,
        contract: harness.planned.semanticContract,
        focus: NO_FOCUS,
        executor: harness.executor,
        signal: SIGNAL,
      });

      expect(outcome).toMatchObject({
        state: 'failed',
        mutation: 'not-sent',
        retrySafe: true,
        stage: 'workbook-preflight',
      });
      expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
    },
  );

  it('fails before mutation when the embedded target worksheet differs from the locked source', async () => {
    const harness = successfulExecutor();
    vi.mocked(harness.executor.getWorkbookDocument)
      .mockReset()
      .mockResolvedValue(
        Ok(
          document(
            workbook(
              sourceWorksheet().replace("value='Profit (USD)'", "value='Changed in workbook'"),
            ),
          ),
        ),
      );

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'workbook-preflight',
    });
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it.each(['error result', 'thrown error'] as const)(
    'marks an apply transport %s unknown and unsafe to retry',
    async (failure) => {
      const harness = successfulExecutor();
      if (failure === 'error result') {
        harness.applyWorksheetDocument.mockResolvedValue(
          Err({ type: 'unknown', error: 'connection lost after POST' }),
        );
      } else {
        harness.applyWorksheetDocument.mockRejectedValue(new Error('socket closed during POST'));
      }

      const outcome = await applyRoundedStackedBar({
        sourceWorksheetXml: sourceWorksheet(),
        intendedWorksheetXml: harness.planned.xml,
        contract: harness.planned.semanticContract,
        focus: NO_FOCUS,
        executor: harness.executor,
        signal: SIGNAL,
      });

      expect(outcome).toMatchObject({
        state: 'unknown',
        mutation: 'unknown',
        retrySafe: false,
        stage: 'apply-transport',
      });
    },
  );

  it.each(['error result', 'thrown error'] as const)(
    'marks a post-write readback %s sent and unsafe to retry',
    async (failure) => {
      const harness = successfulExecutor();
      const readback = vi
        .mocked(harness.executor.getWorksheetDocument)
        .mockReset()
        .mockResolvedValueOnce(Ok(document(sourceWorksheet())))
        .mockResolvedValueOnce(Ok(document(sourceWorksheet())));
      if (failure === 'error result') {
        readback.mockResolvedValueOnce(Err({ type: 'unknown', error: 'readback unavailable' }));
      } else {
        readback.mockRejectedValueOnce(new Error('readback socket closed'));
      }

      const outcome = await applyRoundedStackedBar({
        sourceWorksheetXml: sourceWorksheet(),
        intendedWorksheetXml: harness.planned.xml,
        contract: harness.planned.semanticContract,
        focus: NO_FOCUS,
        executor: harness.executor,
        signal: SIGNAL,
      });

      expect(outcome).toMatchObject({
        state: 'unknown',
        mutation: 'sent',
        retrySafe: false,
        stage: 'readback',
      });
    },
  );

  it('marks persistent structural and summary mismatch sent after the full poll budget', async () => {
    vi.useFakeTimers();
    try {
      const harness = successfulExecutor();
      vi.mocked(harness.executor.getWorksheetDocument)
        .mockReset()
        .mockResolvedValue(Ok(document(sourceWorksheet())));
      vi.mocked(harness.executor.getWorkbookDocument)
        .mockReset()
        .mockResolvedValue(Ok(document(workbook(sourceWorksheet()))));
      harness.getWorksheetSummaryData.mockReset().mockResolvedValue(Ok(baselineSummary()));

      const pending = applyRoundedStackedBar({
        sourceWorksheetXml: sourceWorksheet(),
        intendedWorksheetXml: harness.planned.xml,
        contract: harness.planned.semanticContract,
        focus: NO_FOCUS,
        executor: harness.executor,
        signal: SIGNAL,
      });
      await vi.runAllTimersAsync();
      const outcome = await pending;

      expect(outcome).toMatchObject({
        state: 'unknown',
        mutation: 'sent',
        retrySafe: false,
        stage: 'verification',
      });
      expect(harness.getWorksheetDocument).toHaveBeenCalledTimes(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks document warnings sent and unsafe to retry', async () => {
    const harness = successfulExecutor();
    harness.applyWorksheetDocument.mockResolvedValue(
      Ok({
        command_id: 'apply',
        status: 'completed',
        submitted_at: '',
        warnings: [{ code: 'dropped-node', message: 'helper dropped' }],
      }),
    );

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'unknown',
      mutation: 'sent',
      retrySafe: false,
      stage: 'document-warning',
    });
  });

  it('keeps source drift returned by the per-sheet route before mutation', async () => {
    const harness = successfulExecutor();
    vi.mocked(harness.executor.getWorksheetDocument)
      .mockReset()
      .mockResolvedValueOnce(Ok(document(sourceWorksheet())))
      .mockResolvedValueOnce(
        Ok(document(sourceWorksheet().replace("value='false'", "value='true'"))),
      );

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'apply-preflight',
    });
    expect(outcome.state !== 'applied' && outcome.message).toContain('source-drift');
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'route-missing',
      worksheets: Err({
        type: 'command-failed' as const,
        error: {
          code: 'not-found',
          message: 'No route matches /v0/workbook/worksheets',
          recoverable: false,
        },
      }),
    },
    { label: 'sheet-absent', worksheets: Ok({ worksheets: [] }) },
  ])('keeps $label before mutation', async ({ label, worksheets }) => {
    const harness = successfulExecutor();
    vi.mocked(harness.executor.listWorksheets).mockResolvedValue(worksheets);

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'apply-preflight',
    });
    expect(outcome.state !== 'applied' && outcome.message).toContain(label);
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('keeps differential validation failure before mutation', async () => {
    const harness = successfulExecutor();
    vi.spyOn(validationRegistry, 'runValidation')
      .mockReturnValueOnce({ valid: true, issues: [] })
      .mockReturnValueOnce({
        valid: false,
        issues: [{ ruleId: 'rounded', severity: 'error', message: 'introduced blocker' }],
      });

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'apply-preflight',
    });
    expect(outcome.state !== 'applied' && outcome.message).toContain('validation-failed');
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('keeps a blank dashboard-member transition before mutation', async () => {
    const harness = successfulExecutor();
    vi.mocked(harness.executor.getWorksheetDocument)
      .mockReset()
      .mockResolvedValue(Ok(document(blankWorksheet())));
    vi.mocked(harness.executor.getWorkbookDocument)
      .mockReset()
      .mockResolvedValue(Ok(document(workbook(blankWorksheet()))));
    vi.mocked(harness.executor.listDashboards).mockResolvedValue(
      Ok({
        dashboards: [
          {
            id: '{DASHBOARD}',
            name: 'Dashboard',
            hidden: false,
            containedSheets: [WORKSHEET_ID],
          },
        ],
      }),
    );

    const outcome = await applyRoundedStackedBar({
      sourceWorksheetXml: blankWorksheet(),
      intendedWorksheetXml: harness.planned.xml,
      contract: harness.planned.semanticContract,
      focus: NO_FOCUS,
      executor: harness.executor,
      signal: SIGNAL,
    });

    expect(outcome).toMatchObject({
      state: 'failed',
      mutation: 'not-sent',
      retrySafe: true,
      stage: 'apply-preflight',
    });
    expect(outcome.state !== 'applied' && outcome.message).toContain(
      'dashboard-member-blank-transition',
    );
    expect(harness.applyWorksheetDocument).not.toHaveBeenCalled();
  });

  it('serializes the full preflight and apply transaction under one lock', async () => {
    const planned = plan();
    let releaseFirst!: () => void;
    const firstReadResult = new Promise((resolve) => {
      releaseFirst = () =>
        resolve(Ok(document(sourceWorksheet().replace("value='false'", "value='true'"))));
    });
    const firstRead = vi.fn().mockReturnValue(firstReadResult);
    const secondRead = vi
      .fn()
      .mockResolvedValue(Ok(document(sourceWorksheet().replace("value='false'", "value='true'"))));
    const firstExecutor = makeExecutorMock({ getWorksheetDocument: firstRead });
    const secondExecutor = makeExecutorMock({ getWorksheetDocument: secondRead });
    const args = {
      sourceWorksheetXml: sourceWorksheet(),
      intendedWorksheetXml: planned.xml,
      contract: planned.semanticContract,
      focus: NO_FOCUS,
      signal: SIGNAL,
    };

    const first = applyRoundedStackedBar({ ...args, executor: firstExecutor });
    await vi.waitFor(() => expect(firstRead).toHaveBeenCalledTimes(1));
    const second = applyRoundedStackedBar({ ...args, executor: secondExecutor });
    await Promise.resolve();
    expect(secondRead).not.toHaveBeenCalled();

    releaseFirst();
    await first;
    await vi.waitFor(() => expect(secondRead).toHaveBeenCalledTimes(1));
    await second;
  });
});
