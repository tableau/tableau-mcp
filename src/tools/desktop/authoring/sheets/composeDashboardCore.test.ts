import { Err, Ok } from 'ts-results-es';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import {
  buildDashboardCandidateXml,
  composeDashboardCore,
  type ComposeDashboardCoreArgs,
  dashboardCandidateReadbackIssues,
  resolveRenderedWorksheetNames,
} from './composeDashboardCore.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');

// `<rows>`/`<cols>` text (any non-empty text, here just the field name) is enough for
// worksheetRenderState's `worksheetDocumentState` to classify a `<table>` as rendered; see the
// `resolveRenderedWorksheetNames` describe block below for the blank-vs-populated distinction.
const PRISTINE = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Sales"><table><rows>Sales</rows></table></worksheet>
    <worksheet name="Profit"><table><rows>Profit</rows></table></worksheet>
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

const WITH_ORDERS = PRISTINE.replace(
  '</worksheets>',
  '<worksheet name="Orders"><table/></worksheet></worksheets>',
).replace('</windows>', '<window class="worksheet" name="Orders"/></windows>');

const WITH_INHERITED_NAMESPACES = `<?xml version="1.0"?>
<workbook>
  <worksheets xmlns:user="urn:tableau:user" xmlns:mid="urn:intermediate">
    <worksheet name="Namespaced"><table><view>
      <groupfilter function="level-members" level="[none:Category:nk]" user:ui-domain="relevant" user:ui-enumeration="inclusive"/>
      <mid:metadata-record/>
      <pane xmlns:user="urn:local"><groupfilter function="level-members" level="[none:Category:nk]" user:ui-domain="database" user:ui-enumeration="all"/></pane>
    </view><rows>[none:Category:nk]</rows><cols/></table></worksheet>
  </worksheets>
  <dashboards/>
  <windows><window class="worksheet" name="Namespaced"/></windows>
</workbook>`;

const WITH_ENTITY_DISTINCT_NAMES = `<workbook><worksheets>
  <worksheet name="A &amp; B"><table><rows>[none:First:nk]</rows><cols/></table></worksheet>
  <worksheet name="A &amp;amp; B"><table><rows>[none:Second:nk]</rows><cols/></table></worksheet>
</worksheets><dashboards/><windows>
  <window class="worksheet" name="A &amp; B"/>
  <window class="worksheet" name="A &amp;amp; B"/>
</windows></workbook>`;

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

    expect(candidateXml).toContain('h="12000" id="11" name="Sales" w="100000" x="0" y="6000"');
    expect(candidateXml).toContain('h="82000" id="12" name="Profit" w="100000" x="0" y="18000"');
  });

  it('places multiple KPI worksheets left to right in the requested order', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: WITH_ORDERS,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit', 'Orders'],
      layout: {
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['Profit', 'Sales'],
      },
    });

    expect(candidateXml).toContain('h="12000" id="10" name="Profit" w="50000" x="0" y="0"');
    expect(candidateXml).toContain('h="12000" id="11" name="Sales" w="50000" x="50000" y="0"');
    expect(candidateXml).toContain('h="88000" id="12" name="Orders" w="100000" x="0" y="12000"');
  });

  it('uses the executive primary-secondary chart split instead of the generic grid', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: WITH_ORDERS,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit', 'Orders'],
      layout: {
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['Sales'],
      },
    });

    expect(candidateXml).toContain('h="88000" id="11" name="Profit" w="60000" x="0" y="12000"');
    expect(candidateXml).toContain('h="88000" id="12" name="Orders" w="40000" x="60000" y="12000"');
  });
});

describe('dashboardCandidateReadbackIssues', () => {
  it('accepts Desktop rounding each zone geometry attribute by one unit', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      layout: { layoutType: 'columns' },
    });
    const readbackXml = candidateXml.replace(
      'h="100000" id="10" name="Sales" w="50000" x="0" y="0"',
      'h="99999" id="10" name="Sales" w="50001" x="1" y="1"',
    );
    expect(readbackXml).not.toBe(candidateXml);

    expect(
      dashboardCandidateReadbackIssues(readbackXml, candidateXml, 'Sales Dashboard', [
        'Sales',
        'Profit',
      ]),
    ).toEqual([]);
  });

  it('rejects a zone geometry difference of two units', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      layout: { layoutType: 'columns' },
    });
    const readbackXml = candidateXml.replace(
      'h="100000" id="10" name="Sales" w="50000" x="0" y="0"',
      'h="100000" id="10" name="Sales" w="50002" x="0" y="0"',
    );
    expect(readbackXml).not.toBe(candidateXml);

    expect(
      dashboardCandidateReadbackIssues(readbackXml, candidateXml, 'Sales Dashboard', [
        'Sales',
        'Profit',
      ]),
    ).toEqual([
      'Dashboard "Sales Dashboard" readback did not match the requested title and layout.',
    ]);
  });

  it('still rejects non-geometry structural differences', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      title: 'Executive Overview',
      layout: { layoutType: 'columns' },
    });
    const readbackXml = candidateXml.replace(
      'bold="true" fontalignment="1" fontsize="16"',
      'bold="false" fontalignment="1" fontsize="16"',
    );
    expect(readbackXml).not.toBe(candidateXml);

    expect(
      dashboardCandidateReadbackIssues(readbackXml, candidateXml, 'Sales Dashboard', [
        'Sales',
        'Profit',
      ]),
    ).toEqual([
      'Dashboard "Sales Dashboard" readback did not match the requested title and layout.',
    ]);
  });
});

describe('resolveRenderedWorksheetNames', () => {
  it('does not resolve a named worksheet with a matching window whose table is blank', () => {
    const workbookXml = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Blank"><table><rows></rows><cols></cols></table></worksheet>
  </worksheets>
  <windows>
    <window class="worksheet" name="Blank"/>
  </windows>
</workbook>`;

    expect(resolveRenderedWorksheetNames(workbookXml, ['Blank'])).toEqual([undefined]);
  });

  it('resolves a worksheet that has a placed field reference even with empty rows/cols text', () => {
    const workbookXml = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Rendered"><table><view>
      <datasource-dependencies datasource="Sample - Superstore">
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
      </datasource-dependencies>
    </view><rows></rows><cols>[Sample - Superstore].[sum:Sales:qk]</cols></table></worksheet>
  </worksheets>
  <windows>
    <window class="worksheet" name="Rendered"/>
  </windows>
</workbook>`;

    expect(resolveRenderedWorksheetNames(workbookXml, ['Rendered'])).toEqual(['Rendered']);
  });

  it('still refuses names that lack a matching window, and names that do not exist at all', () => {
    const workbookXml = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="NoWindow"><table><rows>Sales</rows></table></worksheet>
  </worksheets>
  <windows/>
</workbook>`;

    expect(resolveRenderedWorksheetNames(workbookXml, ['NoWindow', 'Nonexistent'])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('resolves a genuinely rendered worksheet with a matching window', () => {
    expect(resolveRenderedWorksheetNames(PRISTINE, ['Sales', 'Profit'])).toEqual([
      'Sales',
      'Profit',
    ]);
  });

  it('resolves a populated worksheet with workbook, intermediate, and locally rebound namespaces', () => {
    expect(resolveRenderedWorksheetNames(WITH_INHERITED_NAMESPACES, ['Namespaced'])).toEqual([
      'Namespaced',
    ]);
  });

  it('does not resolve a blank worksheet that depends on ancestor namespace declarations', () => {
    const workbookXml = `<workbook xmlns:user="urn:workbook">
      <worksheets><worksheet name="Namespaced Blank"><table><view><groupfilter function="level-members" level="Category" user:ui-domain="relevant" user:ui-enumeration="inclusive"/></view><rows/><cols/></table></worksheet></worksheets>
      <windows><window class="worksheet" name="Namespaced Blank"/></windows>
    </workbook>`;

    expect(resolveRenderedWorksheetNames(workbookXml, ['Namespaced Blank'])).toEqual([undefined]);
  });

  it('does not let an extension worksheet make the canonical blank worksheet renderable', () => {
    const workbookXml = `<workbook>
      <extension><worksheets>
        <worksheet name="Canonical"><table><rows>[none:Extension:nk]</rows><cols/></table></worksheet>
      </worksheets></extension>
      <worksheets><worksheet name="Canonical"><table><rows/><cols/></table></worksheet></worksheets>
      <windows><window class="worksheet" name="Canonical"/></windows>
    </workbook>`;

    expect(resolveRenderedWorksheetNames(workbookXml, ['Canonical'])).toEqual([undefined]);
  });

  it('does not let an extension window satisfy the canonical worksheet window check', () => {
    const workbookXml = `<workbook>
      <extension><windows><window class="worksheet" name="Canonical"/></windows></extension>
      <worksheets>
        <worksheet name="Canonical"><table><rows>[none:Category:nk]</rows><cols/></table></worksheet>
      </worksheets>
      <windows><window class="dashboard" name="Canonical"/></windows>
    </workbook>`;

    expect(resolveRenderedWorksheetNames(workbookXml, ['Canonical'])).toEqual([undefined]);
  });

  it('resolves worksheet names that differ only by one level of entity escaping independently', () => {
    expect(
      resolveRenderedWorksheetNames(WITH_ENTITY_DISTINCT_NAMES, ['A & B', 'A &amp; B']),
    ).toEqual(['A & B', 'A &amp; B']);
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

  it('preserves inherited worksheet namespaces through candidate apply and readback', async () => {
    const harness = setupHarness({ pristineXml: WITH_INHERITED_NAMESPACES });

    const outcome = await composeDashboardCore({
      dashboardName: 'Namespaced Dashboard',
      worksheetNames: ['Namespaced'],
      layout: { layoutType: 'columns' },
      executor: harness.executor,
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      state: 'applied',
      receipt: { worksheets: ['Namespaced'], verification: { status: 'passed' } },
    });
    expect(harness.postedXml).toHaveLength(1);
    expect(harness.postedXml[0]).toContain('xmlns:user="urn:tableau:user"');
    expect(harness.postedXml[0]).toContain('<mid:metadata-record/>');
    expect(harness.postedXml[0]).toContain('<zone h="100000" id="10" name="Namespaced"');
    expect(harness.postedXml[0]).toContain('<viewpoint name="Namespaced">');
  });

  it('keeps entity-distinct worksheet identities through KPI selection and readback', async () => {
    const harness = setupHarness({ pristineXml: WITH_ENTITY_DISTINCT_NAMES });

    const outcome = await composeDashboardCore({
      dashboardName: 'Entity Dashboard',
      worksheetNames: ['A & B', 'A &amp; B'],
      layout: {
        layoutType: 'executive-summary',
        kpiWorksheetNames: ['A &amp; B'],
      },
      executor: harness.executor,
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      state: 'applied',
      receipt: {
        worksheets: ['A & B', 'A &amp; B'],
        verification: { status: 'passed' },
      },
    });
    expect(harness.postedXml).toHaveLength(1);
    expect(harness.postedXml[0]).toContain(
      'h="12000" id="10" name="A &amp;amp; B" w="100000" x="0" y="0"',
    );
    expect(harness.postedXml[0]).toContain(
      'h="88000" id="11" name="A &amp; B" w="100000" x="0" y="12000"',
    );
    expect(harness.postedXml[0]).toContain('<viewpoint name="A &amp; B">');
    expect(harness.postedXml[0]).toContain('<viewpoint name="A &amp;amp; B">');
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
    return applyResults.shift() ?? Ok({ validationWarnings: [], documentWarnings: [] });
  });
  return {
    executor: {} as ExternalApiToolExecutor,
    postedXml,
  };
}
