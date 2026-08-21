import { Err, Ok } from 'ts-results-es';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import {
  buildDashboardCandidateXml,
  composeDashboardCore,
  type ComposeDashboardCoreArgs,
} from './composeDashboardCore.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');

const PRISTINE = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Sales"><table/></worksheet>
    <worksheet name="Profit"><table/></worksheet>
  </worksheets>
  <dashboards><dashboard name="Keep"><zones><zone name="Sales"/></zones></dashboard></dashboards>
  <windows>
    <window class="worksheet" name="Sales"/>
    <window class="worksheet" name="Profit"/>
    <window class="dashboard" name="Keep"><viewpoints><viewpoint name="Sales"/></viewpoints></window>
  </windows>
</workbook>`;

const WITH_EXISTING = PRISTINE.replace(
  '</dashboards>',
  '<dashboard name="Sales Dashboard"><zones><zone name="Sales"/></zones></dashboard></dashboards>',
).replace(
  '</windows>',
  '<window class="dashboard" name="Sales Dashboard"><viewpoints><viewpoint name="Sales"/></viewpoints></window></windows>',
);

describe('buildDashboardCandidateXml', () => {
  it('builds an escaped dashboard with layout zones and viewpoints into the baseline workbook', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales & "Profit"',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      title: 'Executive <Overview>',
      layout: { layoutType: 'columns' },
    });

    expect(candidateXml).toContain('<dashboard name="Keep"');
    expect(candidateXml).toContain('name="Sales &amp; &quot;Profit&quot;"');
    expect(candidateXml).toContain('Executive &lt;Overview&gt;');
    expect(candidateXml).toContain('name="Sales" w="50000" x="0" y="8000"');
    expect(candidateXml).toContain('name="Profit" w="50000" x="50000" y="8000"');
    expect(candidateXml).toContain(
      '<viewpoint name="Sales"><zoom type="entire-view"/></viewpoint>',
    );
    expect(candidateXml).toContain(
      '<viewpoint name="Profit"><zoom type="entire-view"/></viewpoint>',
    );
  });

  it('places named KPI worksheets in the executive-summary strip', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      title: 'Executive Overview',
      layout: {
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['Sales'],
      },
    });

    expect(candidateXml).toContain('h="20000" id="11" name="Sales" w="100000" x="0" y="8000"');
    expect(candidateXml).toContain('h="72000" id="12" name="Profit" w="100000" x="0" y="28000"');
  });
});

describe('composeDashboardCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns applied only after invariant readback passes', async () => {
    const harness = setupHarness({ pristineXml: PRISTINE });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'applied',
      retrySafe: false,
      receipt: { dashboard: 'Sales Dashboard', replaced: false },
    });
    expect(harness.postedXml).toHaveLength(1);
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineXml: PRISTINE,
        expectedWorkbookXml: PRISTINE,
        focus: { navigate: 'artifact', sheetName: 'Sales Dashboard' },
      }),
    );
  });

  it('reports a guarded stale workbook as failed before dispatch', async () => {
    const harness = setupHarness({
      pristineXml: PRISTINE,
      applyResults: [Err({ type: 'load-workbook-xml-error', error: { type: 'workbook-drift' } })],
    });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'failed',
      retrySafe: true,
      stage: 'pre-dispatch-workbook-drift',
    });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it('reports failed readback after dispatch as unknown', async () => {
    const harness = setupHarness({
      pristineXml: PRISTINE,
      readbackResults: [
        Err({
          type: 'command-failed',
          error: { code: 'READ', message: 'failed', recoverable: true },
        }),
      ],
    });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'unknown',
      retrySafe: false,
      stage: 'post-apply-read',
    });
  });

  it('replaces an existing dashboard in memory with one guarded write', async () => {
    const harness = setupHarness({ pristineXml: WITH_EXISTING });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(harness.postedXml).toHaveLength(1);
    expect(harness.postedXml[0]).toContain('name="Keep"');
    expect(harness.postedXml[0]?.match(/name="Sales Dashboard"/g)).toHaveLength(2);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({
      state: 'applied',
      receipt: { replaced: true },
    });
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineXml: WITH_EXISTING,
        expectedWorkbookXml: WITH_EXISTING,
        focus: { navigate: 'artifact', sheetName: 'Sales Dashboard' },
      }),
    );
  });

  it('waits past a stale same-name readback before accepting the replacement', async () => {
    vi.useFakeTimers();
    const harness = setupHarness({
      pristineXml: WITH_EXISTING,
      readbackResults: [Ok(WITH_EXISTING)],
    });

    const outcomePromise = composeDashboardCore(validArgs(harness.executor));
    await vi.runAllTimersAsync();
    const outcome = await outcomePromise;

    expect(outcome).toMatchObject({ state: 'applied', receipt: { replaced: true } });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(3);
  });

  it('refuses a stale replacement before any live delete can happen', async () => {
    const harness = setupHarness({
      pristineXml: WITH_EXISTING,
      applyResults: [Err({ type: 'load-workbook-xml-error', error: { type: 'workbook-drift' } })],
    });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'failed',
      retrySafe: true,
      stage: 'pre-dispatch-workbook-drift',
    });
    expect(harness.postedXml).toHaveLength(1);
    expect(harness.postedXml[0]).toContain('name="Sales Dashboard"');
  });

  it('reports an uncertain one-write replacement as unknown, never partial', async () => {
    const harness = setupHarness({
      pristineXml: WITH_EXISTING,
      applyResults: [
        Err({
          type: 'load-workbook-xml-error',
          error: { type: 'load-rejected', message: 'Desktop rejected replacement' },
        }),
      ],
    });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'unknown',
      retrySafe: false,
      stage: 'apply',
    });
    expect(harness.postedXml).toHaveLength(1);
  });
});

function validArgs(executor: ExternalApiToolExecutor): ComposeDashboardCoreArgs {
  return {
    dashboardName: 'Sales Dashboard',
    worksheetNames: ['Sales', 'Profit'],
    title: 'Executive Overview',
    layout: { layoutType: 'columns' as const },
    executor,
    signal: new AbortController().signal,
  };
}

function setupHarness({
  pristineXml,
  applyResults = [],
  readbackResults = [],
}: {
  pristineXml: string;
  applyResults?: Array<Awaited<ReturnType<typeof loadWorkbookXmlModule.loadWorkbookXml>>>;
  readbackResults?: Array<Awaited<ReturnType<typeof getWorkbookXmlModule.getWorkbookXml>>>;
}): { executor: ExternalApiToolExecutor; postedXml: string[] } {
  const postedXml: string[] = [];
  vi.mocked(getWorkbookXmlModule.getWorkbookXml)
    .mockResolvedValueOnce(Ok(pristineXml))
    .mockImplementation(async () => readbackResults.shift() ?? Ok(postedXml.at(-1) ?? pristineXml));
  vi.mocked(loadWorkbookXmlModule.loadWorkbookXml).mockImplementation(async ({ xml }) => {
    postedXml.push(xml);
    return applyResults.shift() ?? Ok({ validationWarnings: [] });
  });
  return {
    executor: {} as ExternalApiToolExecutor,
    postedXml,
  };
}
