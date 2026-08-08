import { Err, Ok } from 'ts-results-es';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { composeDashboardCore, type ComposeDashboardCoreArgs } from './composeDashboardCore.js';

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

describe('composeDashboardCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('deletes and verifies an existing dashboard before recreating it', async () => {
    const harness = setupHarness({ pristineXml: WITH_EXISTING });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(harness.postedXml).toHaveLength(2);
    expect(harness.postedXml[0]).not.toContain('name="Sales Dashboard"');
    expect(harness.postedXml[1]).toContain('name="Sales Dashboard"');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({
      state: 'applied',
      receipt: { replaced: true },
    });
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedWorkbookXml: WITH_EXISTING,
        focus: { navigate: 'none', reason: 'intermediate-leg' },
      }),
    );
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedWorkbookXml: harness.postedXml[0],
        focus: { navigate: 'artifact', sheetName: 'Sales Dashboard' },
      }),
    );
  });

  it('stops when delete readback still contains the old dashboard', async () => {
    const harness = setupHarness({
      pristineXml: WITH_EXISTING,
      readbackResults: [Ok(WITH_EXISTING)],
    });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'unknown',
      retrySafe: false,
      stage: 'replace-delete-readback',
    });
    expect(harness.postedXml).toHaveLength(1);
  });

  it('reports partial when delete lands but recreation fails', async () => {
    const harness = setupHarness({
      pristineXml: WITH_EXISTING,
      applyResults: [
        Ok({ validationWarnings: [] }),
        Err({
          type: 'load-workbook-xml-error',
          error: { type: 'load-rejected', message: 'Desktop rejected replacement' },
        }),
      ],
    });

    const outcome = await composeDashboardCore(validArgs(harness.executor));

    expect(outcome).toMatchObject({
      state: 'partial',
      retrySafe: false,
      stage: 'replace-create',
    });
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
