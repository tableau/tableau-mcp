import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import * as episodeEvents from '../../../../desktop/episode-events.js';
import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import type { ApplyWorkbookDocumentOptions } from '../../../../desktop/externalApi/executorTypes.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import type { DashboardItem } from '../../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import * as fingerprintModule from './analyticalFingerprint.js';
import { getApplyWorkbookStyleTool } from './applyWorkbookStyle.js';
import type { TableauStylePackV2 } from './stylePack.js';

const stylePack: TableauStylePackV2 = {
  schema: 'tableau.style-pack/v2',
  pack: 'fixture-style-guide',
  version: '1.0.0',
  provenance: { title: 'Fixture', sourceSha256: 'a'.repeat(64) },
  typography: { titleFont: 'Tableau Semibold', bodyFont: 'Tableau Regular' },
  palette: {
    brandPrimary: '#7759C2',
    categorical: ['#7759C2', '#FC6D26'],
    sequential: ['#F1ECFF', '#7759C2'],
    diverging: { negative: '#D63939', midpoint: '#FFFFFF', positive: '#108548' },
    text: '#171321',
    background: '#FFFFFF',
  },
  formats: {
    currency: 'USD_ABBREVIATED',
    date: 'yyyy-mm-dd',
    time: 'HH:mm UTC',
    fiscalQuarter: 'Qn',
    fiscalYear: 'FYyy',
    fiscalYearQuarter: 'FYyy-Qn',
  },
  dashboard: { outerPadding: 16, innerSpacing: 12, titleAlignment: 'left' },
  advisoryRules: { avoidPieCharts: true, labelCalculatedData: true },
};

const baselineXml =
  '<workbook><worksheets>' +
  '<worksheet name="Styled"><layout-options><title><formatted-text><run fontname="Tableau Light" fontcolor="#000000">Styled</run></formatted-text></title></layout-options><table/></worksheet>' +
  '<worksheet name="Plain"><table/></worksheet>' +
  '</worksheets><dashboards/></workbook>';

const inventory = {
  title: 'Book',
  unsavedChanges: false,
  worksheets: [
    { id: 'styled-id', name: 'Styled', hidden: false },
    { id: 'plain-id', name: 'Plain', hidden: false },
  ],
  dashboards: [] as DashboardItem[],
};

describe('apply-workbook-style', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers the exact guarded style-pack input', () => {
    const tool = getApplyWorkbookStyleTool(new DesktopMcpServer());

    expect(tool.name).toBe('apply-workbook-style');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      stylePack: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });
  });

  it('performs one inventory, baseline, drift, dispatch, and settled readback sequence', async () => {
    const harness = makeHarness();
    const emitSpy = vi.spyOn(episodeEvents, 'emitEpisodeEvent').mockResolvedValue();

    const result = await callTool(harness.executor);
    const body = bodyOf(result);

    expect(result.isError).toBe(false);
    expect(harness.executor.getWorkbook).toHaveBeenCalledOnce();
    expect(harness.executor.getWorkbookDocument).toHaveBeenCalledTimes(3);
    expect(harness.posts).toHaveLength(1);
    expect(harness.executor.applyWorkbookDocument).toHaveBeenCalledOnce();
    expect(harness.applyOptions?.expectedInstanceId).toBe('instance-live');
    expect(harness.applyOptions?.onDispatch).toEqual(expect.any(Function));
    expect(body).toMatchObject({
      applied: true,
      retrySafe: false,
      changedEligibleIds: ['styled-id'],
      unchangedEligibleIds: ['plain-id'],
      verification: {
        status: 'passed',
        analyticalFingerprint: 'passed',
        idempotence: 'passed',
      },
    });
    expect(result.structuredContent?.nextAction).toMatchObject({
      kind: 'done',
      receipt: {
        did: expect.arrayContaining([
          expect.stringContaining('guarded workbook style update'),
          expect.stringContaining('zero remaining eligible style changes'),
        ]),
        didNot: expect.arrayContaining([expect.stringContaining('brand-primary-unsupported')]),
        unverified: [expect.stringContaining('rendered appearance')],
      },
    });
    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'apply_succeeded',
        tool: 'apply-workbook-style',
        promise_outcome: 'verified',
      }),
    );
  });

  it('dispatches and verifies a live-shaped eligible dashboard title style change', async () => {
    const dashboardBaseline =
      '<workbook><worksheets/><dashboards><dashboard name="Sales and Profit Overview"><style/><zones><zone type-v2="layout-basic"><zone type-v2="text"><formatted-text><run fontcolor="#1f77b4" fontname="Tableau Light">Sales and Profit Overview</run></formatted-text></zone></zone></zones></dashboard></dashboards></workbook>';
    const harness = makeHarness({
      baseline: dashboardBaseline,
      inventoryOverride: {
        ...inventory,
        worksheets: [],
        dashboards: [
          {
            id: 'dashboard-id',
            name: 'Sales and Profit Overview',
            hidden: false,
            containedSheets: [],
          },
        ],
      },
    });

    const result = await callTool(harness.executor);

    expect(result.isError).toBe(false);
    expect(harness.posts).toHaveLength(1);
    expect(harness.posts[0]).toContain('fontname="Tableau Semibold"');
    expect(harness.posts[0]).toContain('fontcolor="#171321"');
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      changedEligibleIds: ['dashboard-id'],
      verification: { status: 'passed', analyticalFingerprint: 'passed', idempotence: 'passed' },
    });
  });

  it('returns a terminal no-op with zero POST when every eligible style value already matches', async () => {
    const matching = baselineXml
      .replace('Tableau Light', 'Tableau Semibold')
      .replace('#000000', '#171321');
    const harness = makeHarness({ baseline: matching });

    const result = await callTool(harness.executor);
    const body = bodyOf(result);

    expect(result.isError).toBe(false);
    expect(harness.posts).toEqual([]);
    expect(harness.executor.getWorkbookDocument).toHaveBeenCalledOnce();
    expect(body).toMatchObject({
      applied: false,
      retrySafe: true,
      changedEligibleIds: [],
      unchangedEligibleIds: ['styled-id', 'plain-id'],
      verification: { status: 'not-needed' },
    });
    expect(result.structuredContent?.nextAction).toMatchObject({
      kind: 'done',
      label: 'No supported style changes needed',
      receipt: {
        did: [
          expect.stringMatching(
            /no supported style changes.*existing targets already matched.*no supported target/i,
          ),
        ],
        didNot: expect.arrayContaining([
          expect.stringContaining('not yet automated by apply-workbook-style'),
        ]),
        unverified: [expect.stringContaining('rendered appearance')],
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/\bv1\b/i);
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /(?:pack|schema|tableau build|style engine).*(?:incompatib|unsupported|not supported)/i,
    );
  });

  it('rejects an invalid pack before any POST', async () => {
    const harness = makeHarness();
    const invalidPack = { ...stylePack, schema: 'tableau.style-pack/v1' };

    const result = await callTool(harness.executor, invalidPack as TableauStylePackV2);

    expect(result.isError).toBe(true);
    expect(harness.posts).toEqual([]);
    expect(bodyOf(result)).toMatchObject({ applied: false, retrySafe: true });
  });

  it('rejects ambiguous eligibility and candidate fingerprint drift before any POST', async () => {
    const ambiguousHarness = makeHarness({
      inventoryOverride: {
        ...inventory,
        worksheets: [
          ...inventory.worksheets,
          { id: 'duplicate-id', name: 'Styled', hidden: false },
        ],
      },
    });
    const ambiguous = await callTool(ambiguousHarness.executor);
    expect(ambiguous.isError).toBe(true);
    expect(ambiguousHarness.posts).toEqual([]);
    expect(bodyOf(ambiguous)).toMatchObject({ applied: false, retrySafe: true });

    const fingerprintHarness = makeHarness();
    vi.spyOn(fingerprintModule, 'analyticalFingerprint')
      .mockReturnValueOnce('baseline')
      .mockReturnValueOnce('candidate');
    const fingerprint = await callTool(fingerprintHarness.executor);
    expect(fingerprint.isError).toBe(true);
    expect(fingerprintHarness.posts).toEqual([]);
    expect(bodyOf(fingerprint)).toMatchObject({
      applied: false,
      retrySafe: true,
      verification: { analyticalFingerprint: 'mismatch' },
    });
  });

  it('returns retry-safe false-applied on stale guarded read before dispatch', async () => {
    const harness = makeHarness({ driftXml: baselineXml.replace('Plain', 'Drifted') });

    const result = await callTool(harness.executor);

    expect(result.isError).toBe(true);
    expect(harness.posts).toEqual([]);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      verification: { status: 'not-run' },
    });
  });

  it('marks a dispatch error unknown and explicitly forbids retry', async () => {
    const harness = makeHarness({ dispatchError: true });

    const result = await callTool(harness.executor);
    const body = bodyOf(result);

    expect(result.isError).toBe(true);
    expect(harness.posts).toHaveLength(1);
    expect(body).toMatchObject({ applied: 'unknown', retrySafe: false });
    expect(JSON.stringify(body)).toContain('Do not retry');
    expect(result.structuredContent?.nextAction).toMatchObject({
      kind: 'prefill',
      label: expect.stringMatching(/inspect.*do not retry/i),
    });
  });

  it('marks readback errors and semantic mismatches unknown without retrying', async () => {
    const readErrorHarness = makeHarness({ readbackError: true });
    const readError = await callTool(readErrorHarness.executor);
    expect(bodyOf(readError)).toMatchObject({ applied: 'unknown', retrySafe: false });

    vi.useFakeTimers();
    const extraSheetHarness = makeHarness({
      readbackTransform: (xml) =>
        xml.replace(
          '</worksheets>',
          '<worksheet name="Unexpected"><table/></worksheet></worksheets>',
        ),
    });
    const pending = callTool(extraSheetHarness.executor);
    await vi.runAllTimersAsync();
    const extraSheet = await pending;

    expect(extraSheetHarness.posts).toHaveLength(1);
    expect(bodyOf(extraSheet)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      verification: { status: 'unknown' },
    });
    expect(JSON.stringify(bodyOf(extraSheet))).toContain('Do not retry');
  });

  it('rejects readback that changes supported presentation on an ineligible hidden worksheet', async () => {
    vi.useFakeTimers();
    const hiddenBaseline = baselineXml.replace(
      '</worksheets>',
      '<worksheet name="Hidden"><layout-options><title><formatted-text><run fontname="Tableau Light">Hidden</run></formatted-text></title></layout-options><table/></worksheet></worksheets>',
    );
    const harness = makeHarness({
      baseline: hiddenBaseline,
      inventoryOverride: {
        ...inventory,
        worksheets: [...inventory.worksheets, { id: 'hidden-id', name: 'Hidden', hidden: true }],
      },
      readbackTransform: (xml) =>
        xml.replace(
          '<run fontname="Tableau Light">Hidden</run>',
          '<run fontname="Tableau Bold">Hidden</run>',
        ),
    });

    const pending = callTool(harness.executor);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      verification: { status: 'unknown' },
    });
  });

  it.each([
    {
      label: 'categorical',
      code: 'categorical-palette-arity-mismatch',
      styleXml:
        '<table><style><style-rule element="mark"><encoding attr="color" type="palette"><map to="#111111"><bucket>A</bucket></map><map to="#222222"><bucket>B</bucket></map></encoding></style-rule></style></table>',
      pack: {
        ...stylePack,
        palette: { ...stylePack.palette, categorical: ['#111111', '#222222', '#333333'] },
      },
      before: 'to="#111111"',
      after: 'to="#999999"',
    },
    {
      label: 'sequential',
      code: 'sequential-palette-arity-mismatch',
      styleXml:
        '<table><style><style-rule element="mark"><encoding attr="color" type="custom-interpolated"><color-palette custom="true" type="ordered-sequential"><color>#111111</color><color>#222222</color></color-palette></encoding></style-rule></style></table>',
      pack: {
        ...stylePack,
        palette: { ...stylePack.palette, sequential: ['#111111', '#222222', '#333333'] },
      },
      before: '<color>#111111</color>',
      after: '<color>#999999</color>',
    },
    {
      label: 'diverging',
      code: 'diverging-palette-arity-mismatch',
      styleXml:
        '<table><style><style-rule element="mark"><encoding attr="color" type="custom-interpolated"><color-palette custom="true" type="ordered-diverging"><color>#111111</color><color>#222222</color></color-palette></encoding></style-rule></style></table>',
      pack: stylePack,
      before: '<color>#111111</color>',
      after: '<color>#999999</color>',
    },
  ])(
    'rejects $label palette readback changes when arity mismatch skipped the palette',
    async ({ code, styleXml, pack, before, after }) => {
      vi.useFakeTimers();
      const mismatchBaseline = baselineXml.replace('<table/>', styleXml);
      const harness = makeHarness({
        baseline: mismatchBaseline,
        readbackTransform: (xml) => xml.replace(before, after),
      });

      const pending = callTool(harness.executor, pack as TableauStylePackV2);
      await vi.runAllTimersAsync();
      const result = await pending;
      const body = bodyOf(result);

      expect(harness.posts).toHaveLength(1);
      expect(body.findings).toContainEqual(expect.objectContaining({ code }));
      expect(body).toMatchObject({
        applied: 'unknown',
        retrySafe: false,
        verification: { status: 'unknown' },
      });
    },
  );

  it('keeps findings and the structured receipt bounded and explicit', async () => {
    const harness = makeHarness();

    const result = await callTool(harness.executor);
    const body = bodyOf(result);

    expect(body.findings.length).toBeLessThanOrEqual(32);
    expect(body.findings).toContainEqual(
      expect.objectContaining({ code: 'brand-primary-unsupported' }),
    );
    expect(JSON.stringify(body).length).toBeLessThan(12_000);
    expect(result.structuredContent).toMatchObject({
      applied: true,
      verification: { status: 'passed' },
      nextAction: { kind: 'done', receipt: expect.any(Object) },
    });
    expect(
      JSON.stringify({ findings: body.findings, receipt: result.structuredContent }),
    ).not.toMatch(/\bv1\b/i);
    expect(JSON.stringify(result.structuredContent)).toContain(
      'not yet automated by apply-workbook-style',
    );
    expect(JSON.stringify(result)).not.toMatch(/render(?:ed|ing) (?:verified|confirmed)/i);
  });
});

async function callTool(
  executor: ExternalApiToolExecutor,
  pack: TableauStylePackV2 = stylePack,
): Promise<CallToolResult> {
  const server = new DesktopMcpServer();
  (
    server as unknown as { mcpServer: { server: { notification: ReturnType<typeof vi.fn> } } }
  ).mcpServer = { server: { notification: vi.fn() } };
  const tool = getApplyWorkbookStyleTool(server);
  const callback = await Provider.from(tool.callback);
  return await callback(
    { session: 'S1', stylePack: pack },
    { ...getMockRequestHandlerExtra(), getExecutor: vi.fn().mockResolvedValue(executor) },
  );
}

function makeHarness({
  baseline = baselineXml,
  driftXml,
  dispatchError = false,
  readbackError = false,
  readbackTransform,
  inventoryOverride = inventory,
}: {
  baseline?: string;
  driftXml?: string;
  dispatchError?: boolean;
  readbackError?: boolean;
  readbackTransform?: (xml: string) => string;
  inventoryOverride?: typeof inventory;
} = {}): {
  executor: ExternalApiToolExecutor;
  posts: string[];
  applyOptions: ApplyWorkbookDocumentOptions | undefined;
} {
  let liveXml = baseline;
  let documentReads = 0;
  const posts: string[] = [];
  let applyOptions: ApplyWorkbookDocumentOptions | undefined;
  const getWorkbookDocument = vi.fn(async () => {
    documentReads += 1;
    if (documentReads === 2 && driftXml) {
      return Ok({
        xml: driftXml,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
        instanceId: 'instance-live',
      });
    }
    if (documentReads >= 3 && readbackError) {
      return Err({ type: 'command-timed-out' as const, error: 'readback timed out' });
    }
    const xml = documentReads >= 3 && readbackTransform ? readbackTransform(liveXml) : liveXml;
    return Ok({
      xml,
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
      instanceId: 'instance-live',
    });
  });
  const executor = makeExecutorMock({
    getWorkbook: vi.fn().mockResolvedValue(Ok(inventoryOverride)),
    getWorkbookDocument,
    applyWorkbookDocument: vi.fn(
      async (xml: string, _signal: AbortSignal, options?: ApplyWorkbookDocumentOptions) => {
        applyOptions = options;
        options?.onDispatch?.();
        posts.push(xml);
        if (dispatchError) {
          return Err({ type: 'command-timed-out' as const, error: 'dispatch timed out' });
        }
        liveXml = xml;
        return Ok({ command_id: 'style-1', status: 'completed' as const, submitted_at: 'now' });
      },
    ),
  });
  return {
    executor,
    posts,
    get applyOptions() {
      return applyOptions;
    },
  };
}

function bodyOf(result: CallToolResult): Record<string, any> {
  invariant(result.content[0]?.type === 'text');
  return JSON.parse(result.content[0].text) as Record<string, any>;
}
