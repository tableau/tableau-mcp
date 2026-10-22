import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Err, Ok } from 'ts-results-es';

import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import {
  buildDashboardCandidateXml,
  composeDashboardCore,
  type ComposeDashboardCoreArgs,
  dashboardCandidateReadbackIssues,
  resolveLiveWorksheetNames,
} from './composeDashboardCore.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');

// `<rows>`/`<cols>` text (any non-empty text, here just the field name) is enough for
// worksheetRenderState's `worksheetDocumentState` to classify a `<table>` as rendered rather than
// blank. Both states are eligible for explicit dashboard composition.
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
  it('rejects a changed horizontal row flow parameter', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      layout: { layoutType: 'columns' },
    });
    const readbackXml = candidateXml.replace('param="horz"', 'param="vert"');
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

  it('rejects a worksheet moved out of its horizontal parent even when zone order is unchanged', () => {
    const candidateXml = buildDashboardCandidateXml({
      baselineXml: PRISTINE,
      dashboardName: 'Sales Dashboard',
      canonicalWorksheetNames: ['Sales', 'Profit'],
      layout: { layoutType: 'columns' },
    });
    const doc = new DOMParser().parseFromString(candidateXml, 'text/xml');
    const flow = Array.from(doc.getElementsByTagName('zone')).find(
      (zone) => zone.getAttribute('param') === 'vert',
    )!;
    const row = Array.from(doc.getElementsByTagName('zone')).find(
      (zone) => zone.getAttribute('param') === 'horz',
    )!;
    const profit = Array.from(doc.getElementsByTagName('zone')).find(
      (zone) => zone.getAttribute('name') === 'Profit',
    )!;
    expect(profit.parentNode).toBe(row);
    flow.appendChild(profit);
    const readbackXml = new XMLSerializer().serializeToString(doc);
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

  describe('Desktop-owned readback (captured from live Desktop)', () => {
    const readFixture = (name: string): string =>
      readFileSync(join(__dirname, '__fixtures__', 'dashboard-readback', name), 'utf8');
    const REVENUE = 'bar chart of revenue by region';
    const COGS = 'bar chart of cogs by product_line';
    const REV_PL = 'bar chart of revenue by product_line';
    const COGS_REGION = 'bar chart of cogs by region';
    const KPI = 'total revenue as a big number KPI';
    const workbookWith = (dashboardXml: string, names: string[], dashboardName: string): string =>
      `<workbook><worksheets>${names
        .map((name) => `<worksheet name="${name}"><table><rows>${name}</rows></table></worksheet>`)
        .join('')}</worksheets><dashboards>${dashboardXml}</dashboards><windows>${names
        .map((name) => `<window class="worksheet" name="${name}"/>`)
        .join('')}<window class="dashboard" name="${dashboardName}"><viewpoints>${names
        .map((name) => `<viewpoint name="${name}"/>`)
        .join('')}</viewpoints></window></windows></workbook>`;
    const cases = [
      {
        file: 'columns.xml',
        name: 'L1 Columns',
        names: [REVENUE, COGS],
        layout: { layoutType: 'columns' as const },
        title: 'L1 Columns',
      },
      {
        file: 'grid3.xml',
        name: 'L2 Grid3',
        names: [REVENUE, COGS, REV_PL],
        layout: { layoutType: 'auto-grid' as const },
        title: 'L2 Grid3',
      },
      {
        file: 'grid4.xml',
        name: 'L3 Grid4',
        names: [REVENUE, COGS, REV_PL, COGS_REGION],
        layout: { layoutType: 'auto-grid' as const, gridColumns: 2 },
        title: undefined,
      },
      {
        file: 'exec.xml',
        name: 'L4 Exec',
        names: [KPI, REVENUE, COGS, REV_PL],
        layout: { layoutType: 'executive-summary' as const, kpiWorksheetNames: [KPI] },
        title: 'L4 Exec',
      },
      {
        file: 'single.xml',
        name: 'L5 Single',
        names: [REVENUE],
        layout: { layoutType: 'rows' as const },
        title: undefined,
      },
      {
        file: 'rows-title.xml',
        name: 'Probe Rows',
        names: [REVENUE, COGS],
        layout: { layoutType: 'rows' as const },
        title: 'Probe Rows',
      },
    ];
    const baselineFor = (c: (typeof cases)[number]): string =>
      `<workbook><worksheets>${c.names
        .map((name) => `<worksheet name="${name}"><table><rows>${name}</rows></table></worksheet>`)
        .join('')}</worksheets><dashboards/><windows>${c.names
        .map((name) => `<window class="worksheet" name="${name}"/>`)
        .join('')}</windows></workbook>`;
    const issuesFor = (c: (typeof cases)[number], dashboardXml: string): string[] =>
      dashboardCandidateReadbackIssues(
        workbookWith(dashboardXml, c.names, c.name),
        buildDashboardCandidateXml({
          baselineXml: baselineFor(c),
          dashboardName: c.name,
          canonicalWorksheetNames: c.names,
          title: c.title,
          layout: c.layout,
        }),
        c.name,
        c.names,
      );

    it.each(cases)('accepts Desktop geometry and layout-cache for $name', (c) => {
      expect(issuesFor(c, readFixture(c.file))).toEqual([]);
    });

    it('accepts an auto-generated Phone device layout added by Desktop', () => {
      const c = cases[0];
      const withPhone = readFixture(c.file).replace(
        '<simple-id',
        `${readFixture('phone-layout-windows.xml')}<simple-id`,
      );
      expect(withPhone).toContain('<devicelayouts>');
      expect(issuesFor(c, withPhone)).toEqual([]);
    });

    const mismatch = [
      'Dashboard "L1 Columns" readback did not match the requested title and layout.',
    ];
    it.each([
      ['flow param flipped', (x: string) => x.replace("param='horz'", "param='vert'")],
      ['title bold changed', (x: string) => x.replace("bold='true'", "bold='false'")],
      ['title text changed', (x: string) => x.replace('>L1 Columns</run>', '>Other</run>')],
      ['zone id changed', (x: string) => x.replace("id='11'", "id='99'")],
      [
        'zone added',
        (x: string) =>
          x.replace(
            "<zone h='96300' id='13'",
            "<zone id='77' type-v2='empty'/><zone h='96300' id='13'",
          ),
      ],
      [
        'worksheet moved to another parent',
        (x: string) => {
          const cogs = /<zone [^>]*id='12'[^]*?<\/zone>\s*/.exec(x)![0];
          return x
            .replace(cogs, '')
            .replace("<zone h='96300' id='13'", `${cogs}<zone h='96300' id='13'`);
        },
      ],
    ])('still rejects %s', (_label, mutate) => {
      const c = cases[0];
      const mutated = mutate(readFixture(c.file));
      expect(mutated).not.toBe(readFixture(c.file));
      expect(issuesFor(c, mutated)).toEqual(mismatch);
    });

    it('still rejects a dropped worksheet zone', () => {
      const c = cases[0];
      const dropped = readFixture(c.file).replace(/<zone [^>]*id='12'[^]*?<\/zone>\s*/, '');
      expect(issuesFor(c, dropped).length).toBeGreaterThan(0);
    });

    it('still rejects a changed zone sizing attribute', () => {
      const c = cases[0];
      const changed = readFixture(c.file).replace("minwidth='1400'", "minwidth='1300'");
      expect(issuesFor(c, changed)).toEqual(mismatch);
    });
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

describe('resolveLiveWorksheetNames', () => {
  it('resolves a named worksheet with a matching window whose table is blank', () => {
    const workbookXml = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Blank"><table><rows></rows><cols></cols></table></worksheet>
  </worksheets>
  <windows>
    <window class="worksheet" name="Blank"/>
  </windows>
</workbook>`;

    expect(resolveLiveWorksheetNames(workbookXml, ['Blank'])).toEqual(['Blank']);
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

    expect(resolveLiveWorksheetNames(workbookXml, ['Rendered'])).toEqual(['Rendered']);
  });

  it('still refuses names that lack a matching window, and names that do not exist at all', () => {
    const workbookXml = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="NoWindow"><table><rows>Sales</rows></table></worksheet>
  </worksheets>
  <windows/>
</workbook>`;

    expect(resolveLiveWorksheetNames(workbookXml, ['NoWindow', 'Nonexistent'])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('resolves a genuinely rendered worksheet with a matching window', () => {
    expect(resolveLiveWorksheetNames(PRISTINE, ['Sales', 'Profit'])).toEqual(['Sales', 'Profit']);
  });

  it('resolves a populated worksheet with workbook, intermediate, and locally rebound namespaces', () => {
    expect(resolveLiveWorksheetNames(WITH_INHERITED_NAMESPACES, ['Namespaced'])).toEqual([
      'Namespaced',
    ]);
  });

  it('does not resolve a blank worksheet that depends on ancestor namespace declarations', () => {
    const workbookXml = `<workbook xmlns:user="urn:workbook">
      <worksheets><worksheet name="Namespaced Blank"><table><view><groupfilter function="level-members" level="Category" user:ui-domain="relevant" user:ui-enumeration="inclusive"/></view><rows/><cols/></table></worksheet></worksheets>
      <windows><window class="worksheet" name="Namespaced Blank"/></windows>
    </workbook>`;

    expect(resolveLiveWorksheetNames(workbookXml, ['Namespaced Blank'])).toEqual([
      'Namespaced Blank',
    ]);
  });

  it('resolves the canonical blank worksheet without using an extension worksheet', () => {
    const workbookXml = `<workbook>
      <extension><worksheets>
        <worksheet name="Canonical"><table><rows>[none:Extension:nk]</rows><cols/></table></worksheet>
      </worksheets></extension>
      <worksheets><worksheet name="Canonical"><table><rows/><cols/></table></worksheet></worksheets>
      <windows><window class="worksheet" name="Canonical"/></windows>
    </workbook>`;

    expect(resolveLiveWorksheetNames(workbookXml, ['Canonical'])).toEqual(['Canonical']);
  });

  it('does not let an extension window satisfy the canonical worksheet window check', () => {
    const workbookXml = `<workbook>
      <extension><windows><window class="worksheet" name="Canonical"/></windows></extension>
      <worksheets>
        <worksheet name="Canonical"><table><rows>[none:Category:nk]</rows><cols/></table></worksheet>
      </worksheets>
      <windows><window class="dashboard" name="Canonical"/></windows>
    </workbook>`;

    expect(resolveLiveWorksheetNames(workbookXml, ['Canonical'])).toEqual([undefined]);
  });

  it('resolves worksheet names that differ only by one level of entity escaping independently', () => {
    expect(resolveLiveWorksheetNames(WITH_ENTITY_DISTINCT_NAMES, ['A & B', 'A &amp; B'])).toEqual([
      'A & B',
      'A &amp; B',
    ]);
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

  it('adds an empty worksheet and reports an advisory warning after readback', async () => {
    const pristineXml = PRISTINE.replace(
      '</worksheets>',
      '<worksheet name="Empty"><table><rows/><cols/></table></worksheet></worksheets>',
    ).replace('</windows>', '<window class="worksheet" name="Empty"/></windows>');
    const harness = setupHarness({ pristineXml });

    const outcome = await composeDashboardCore({
      dashboardName: 'Dashboard with Empty Tile',
      worksheetNames: ['Sales', 'Empty'],
      executor: harness.executor,
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      state: 'applied',
      receipt: {
        worksheets: ['Sales', 'Empty'],
        warnings: [
          'Worksheet "Empty" is empty and will display as an empty tile on the dashboard.',
        ],
      },
    });
    expect(harness.postedXml).toHaveLength(1);
    expect(harness.postedXml[0]).toContain('name="Empty"');
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
