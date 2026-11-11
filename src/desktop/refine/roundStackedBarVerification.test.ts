import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { planRoundStackedBar, type RoundStackedBarSemanticContract } from './roundStackedBar.js';
import {
  captureRoundStackedBarBaseline,
  type RoundStackedBarBaseline,
  type RoundStackedBarVerification,
  type TabularData,
  verifyRoundStackedBarPostSummary,
  verifyRoundStackedBarSeedEvidence,
  verifyRoundStackedBarSourceWorkbook,
  verifyRoundStackedBarStructure,
} from './roundStackedBarVerification.js';

const PREFIX = '__tmcp_round_b157d4fa12a0_';
const WORKSHEET_ID = '{B157D4FA-12A0-495E-BEC4-3572B3567648}';

function directElements(parent: Element, tagName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .filter((node) => tagName === undefined || node.tagName === tagName);
}

function serializeFixture(document: Document): string {
  return new XMLSerializer()
    .serializeToString(document as unknown as Parameters<XMLSerializer['serializeToString']>[0])
    .replace(
      /(\s[\w:.-]+)="([^"]*)"/g,
      (_match, name: string, value: string) => `${name}='${value.replaceAll("'", '&apos;')}'`,
    )
    .replace(/\s*\/>/g, ' />');
}

function prettyPrintNarrationOwners(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
  const worksheet = document.documentElement;
  const layout = directElements(worksheet, 'layout-options')[0];
  if (!layout) throw new Error('missing layout-options');
  for (const tagName of ['caption', 'alt-text']) {
    const owner = directElements(layout, tagName)[0];
    const formatted = owner ? directElements(owner, 'formatted-text')[0] : undefined;
    if (!owner || !formatted) throw new Error(`missing ${tagName}`);
    owner.insertBefore(document.createTextNode('\n      '), formatted);
    owner.appendChild(document.createTextNode('\n    '));
    for (const run of [...directElements(formatted, 'run')].reverse()) {
      formatted.insertBefore(document.createTextNode('\n        '), run);
    }
    formatted.appendChild(document.createTextNode('\n      '));
  }
  return serializeFixture(document);
}

function tableauHostRoundedReadback(xml: string, reverseDeclarations = false): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
  const dependency = document.getElementsByTagName('datasource-dependencies')[0];
  const declarations = directElements(dependency).filter((element) =>
    ['column', 'column-instance'].includes(element.tagName),
  );
  for (const declaration of declarations) dependency.removeChild(declaration);
  const byName = (left: Element, right: Element): number => {
    const a = left.getAttribute('name') ?? '';
    const b = right.getAttribute('name') ?? '';
    const comparison = a < b ? -1 : a > b ? 1 : 0;
    return reverseDeclarations ? -comparison : comparison;
  };
  for (const declaration of [
    ...declarations.filter((element) => element.tagName === 'column').sort(byName),
    ...declarations.filter((element) => element.tagName === 'column-instance').sort(byName),
  ]) {
    dependency.appendChild(declaration);
  }

  const omittedByRole = {
    x: ['_lo]', '_hi]'],
    y: ['_top_radius_x]', '_bottom_radius_x]'],
  } as const;
  for (const role of ['x', 'y'] as const) {
    const instance = directElements(dependency, 'column-instance').find((candidate) =>
      (candidate.getAttribute('column') ?? '').endsWith(`_${role}]`),
    );
    if (!instance) throw new Error(`missing ${role} instance`);
    for (const tableCalc of directElements(instance, 'table-calc')) {
      const field = tableCalc.getAttribute('field') ?? '';
      if (omittedByRole[role].some((suffix) => field.endsWith(suffix))) {
        instance.removeChild(tableCalc);
      }
    }
    for (const tableCalc of directElements(instance, 'table-calc').reverse()) {
      instance.appendChild(tableCalc);
    }
  }

  const style = document.getElementsByTagName('style')[0];
  const axisRules = directElements(style, 'style-rule').filter(
    (rule) => rule.getAttribute('element') === 'axis',
  );
  const hiddenX = axisRules
    .flatMap((rule) => directElements(rule, 'format'))
    .find(
      (format) =>
        format.getAttribute('attr') === 'display' &&
        (format.getAttribute('field') ?? '').endsWith('_x:qk]'),
    );
  if (!hiddenX || axisRules.length === 0) throw new Error('missing hidden X axis format');
  const hiddenXRule = hiddenX.parentNode as Element;
  if (hiddenXRule !== axisRules[0]) {
    hiddenXRule.removeChild(hiddenX);
    axisRules[0].appendChild(hiddenX);
    if (directElements(hiddenXRule).length === 0) hiddenXRule.parentNode?.removeChild(hiddenXRule);
  }
  return serializeFixture(document);
}

type HelperSuffix = 'bin' | 'path' | 'x' | 'y';

function helperCaption(suffix: HelperSuffix): string {
  if (suffix === 'bin') return 'TMCP rounded path frame';
  return `TMCP rounded ${suffix.replaceAll('_', ' ')}`;
}

const sourceGroups = [
  ['Alpha', 'Consumer', 10],
  ['Alpha', 'Corporate', 20],
  ['Alpha', 'Home Office', 30],
  ['Beta', 'Consumer', -4],
  ['Beta', 'Home Office', -6],
] as const;

function summary(
  groups: ReadonlyArray<readonly [unknown, unknown, unknown]> = sourceGroups,
): TabularData {
  return {
    worksheet: { id: WORKSHEET_ID },
    columns: [
      { name: 'SUM(Profit)' },
      { name: 'Tooltip Only' },
      { name: 'Segment' },
      { name: 'Category' },
    ],
    rows: groups.map(([category, segment, value]) => [value, 'extra', segment, category]),
  };
}

function captureBaseline(data = summary()): RoundStackedBarBaseline {
  const result = captureRoundStackedBarBaseline(data, contract);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.baseline;
}

function rawData(overrides: ReadonlyArray<readonly unknown[]> = []): TabularData {
  const rows = sourceGroups.flatMap(([category, segment, value]) => [
    [segment, 'West', value / 3, category],
    [segment, 'West', (value * 2) / 3, category],
  ]);
  return {
    columns: [{ name: 'Segment' }, { name: 'Region' }, { name: 'Profit' }, { name: 'Category' }],
    rows: overrides.length > 0 ? overrides : rows,
  };
}

type Interval = {
  category: string;
  segment: string;
  low: number;
  high: number;
  roundTop?: boolean;
  roundBottom?: boolean;
  radiusScale?: number;
};

function polygonRows(interval: Interval, categorySpan: number): unknown[][] {
  const radius =
    Math.min((interval.high - interval.low) / 2, 0.02 * categorySpan) * (interval.radiusScale ?? 1);
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

function goodIntervals(): Interval[] {
  return [
    { category: 'Alpha', segment: 'Home Office', low: 0, high: 30 },
    { category: 'Alpha', segment: 'Corporate', low: 30, high: 50 },
    { category: 'Alpha', segment: 'Consumer', low: 50, high: 60, roundTop: true },
    { category: 'Beta', segment: 'Home Office', low: -6, high: 0 },
    { category: 'Beta', segment: 'Consumer', low: -10, high: -6, roundBottom: true },
  ];
}

function polygonSummary(
  intervals = goodIntervals(),
  categorySpans: Readonly<Record<string, number>> = { Alpha: 60, Beta: 10 },
): TabularData {
  return {
    worksheet: { id: WORKSHEET_ID },
    columns: [
      { name: `AGG(${helperCaption('x')})` },
      { name: 'Segment' },
      { name: `AGG(${helperCaption('path')})` },
      { name: 'Category' },
      { name: `AGG(${helperCaption('y')})` },
      { name: helperCaption('bin') },
      { name: 'Tooltip Only' },
    ],
    rows: intervals
      .flatMap((interval) => polygonRows(interval, categorySpans[interval.category] ?? 0))
      .reverse(),
  };
}

function helperDefinitions(xml: string, hidden = true, expectedCount = 18): string {
  const definitions = [
    ...xml.matchAll(/<column\b(?=[^>]*\bname='\[__tmcp_round_[^']+\]')[\s\S]*?<\/column>/g),
  ].map(([definition]) => definition);
  expect(definitions).toHaveLength(expectedCount);
  return definitions
    .join('')
    .replaceAll("hidden='true'", hidden ? "hidden='true'" : "hidden='false'");
}

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
      <style-rule element='cell'><format attr='font-size' value='10' /></style-rule>
      <style-rule element='gridline'><format attr='line-visibility' value='off' /></style-rule>
      <style-rule element='table-div'><format attr='line-visibility' value='off' /></style-rule>
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

function sourceWorksheetWithPreservedContent(): string {
  return sourceWorksheet()
    .replace("<column caption='Category'", "<column caption='Category' original='[Category]'")
    .replace(
      '<panes><pane>',
      "<panes><pane selection-relaxation-option='selection-relaxation-allow'>",
    )
    .replace(
      `<simple-id uuid='${WORKSHEET_ID}' />`,
      `<repository-location derived-from='https://example.invalid/kept' /><simple-id uuid='${WORKSHEET_ID}' />`,
    );
}

function plannedWorksheet(): { contract: RoundStackedBarSemanticContract; xml: string } {
  const plan = planRoundStackedBar(sourceWorksheet(), { preset: 'subtle' });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.reason);
  return { contract: plan.semanticContract, xml: plan.xml };
}

const contract = plannedWorksheet().contract;
const simplePlan = planRoundStackedBar(simpleSourceWorksheet(), { preset: 'subtle' });
expect(simplePlan.ok).toBe(true);
if (!simplePlan.ok) throw new Error(simplePlan.reason);
const simpleContract = simplePlan.semanticContract;

function simpleSummary(): TabularData {
  return {
    worksheet: { id: WORKSHEET_ID },
    columns: [{ name: 'Tooltip Only' }, { name: 'Category' }, { name: 'SUM(Profit)' }],
    rows: [
      ['extra', 'Alpha', 12],
      ['extra', 'Beta', -8],
    ],
  };
}

function captureSimpleBaseline(): RoundStackedBarBaseline {
  const captured = captureRoundStackedBarBaseline(simpleSummary(), simpleContract);
  expect(captured.ok).toBe(true);
  if (!captured.ok) throw new Error(captured.reason);
  return captured.baseline;
}

function tinySimpleBaseline(): RoundStackedBarBaseline {
  const captured = captureRoundStackedBarBaseline(
    {
      worksheet: { id: WORKSHEET_ID },
      columns: [{ name: 'Tooltip Only' }, { name: 'Category' }, { name: 'SUM(Profit)' }],
      rows: [
        ['extra', 'Alpha', 1e-5],
        ['extra', 'Beta', -1e-5],
      ],
    },
    simpleContract,
  );
  expect(captured.ok).toBe(true);
  if (!captured.ok) throw new Error(captured.reason);
  return captured.baseline;
}

function simpleRawData(): TabularData {
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

function simplePolygonSummary(
  intervals: Interval[] = [
    { category: 'Alpha', segment: '', low: 0, high: 12, roundTop: true },
    { category: 'Beta', segment: '', low: -8, high: 0, roundBottom: true },
  ],
): TabularData {
  return {
    worksheet: { id: WORKSHEET_ID },
    columns: [
      { name: `AGG(${helperCaption('path')})` },
      { name: 'Category' },
      { name: `AGG(${helperCaption('y')})` },
      { name: helperCaption('bin') },
      { name: `AGG(${helperCaption('x')})` },
      { name: 'Tooltip Only' },
    ],
    rows: intervals
      .flatMap((interval) =>
        polygonRows(interval, Math.abs(interval.high - interval.low)).map((row) => [
          row[2],
          row[3],
          row[4],
          row[5],
          row[0],
          row[6],
        ]),
      )
      .reverse(),
  };
}

function swapGeometryAxes(data: TabularData, xIndex: number, yIndex: number): TabularData {
  return {
    ...data,
    rows: data.rows.map((row) => {
      const swapped = [...row];
      swapped[xIndex] = row[yIndex];
      swapped[yIndex] = row[xIndex];
      return swapped;
    }),
  };
}

function filterAction(
  options: {
    source?: string;
    dashboard?: string;
    target?: string;
    name?: string;
    extra?: string;
  } = {},
): string {
  const { source = 'Other Worksheet', dashboard = 'Other Dashboard', extra = '' } = options;
  const { target = dashboard, name = '[Action1_DE4200E5E5F14FC68D4CEE8CB0439BBB]' } = options;
  return `<action name='${name}' caption='Use ${source} as Filter'>
    <activation type='on-select' auto-clear='true' />
    <source type='sheet' worksheet='${source}' dashboard='${dashboard}' />
    <command command='tsc:tsl-filter'>
      <param name='exclude' value='${source}' />
      <param name='special-fields' value='all' />
      <param name='target' value='${target}' />${extra}
    </command>
  </action>`;
}

function actionsOf(...actions: string[]): string {
  return `<actions>${actions.join('\n')}</actions>`;
}

const FILTER_ACTIONS = actionsOf(filterAction());

const UNRELATED_WORKSHEET = `<worksheet name='Other Worksheet'>
  <table><style><style-rule element='worksheet'><format attr='display-tabs' value='true' /></style-rule></style><title><formatted-text><run>Other worksheet</run></formatted-text></title></table>
  <simple-id uuid='{OTHER-WORKSHEET}' />
</worksheet>`;

const UNRELATED_TABLE_CALCS = [
  "<table-calc ordering-field='[Sales].[none:Segment:nk]' ordering-type='Field' />",
  "<table-calc field='[Sales].[Calculation_Other]' ordering-field='[Sales].[none:Segment:nk]' ordering-type='Field' />",
] as const;

const ORDERED_TYPED_TABLE_CALCS = [
  "<table-calc aggregation='Sum' ordering-type='Rows' type='CumTotal' />",
  "<table-calc ordering-type='Rows' type='PctTotal' />",
] as const;

function unrelatedWorksheetWithTableCalcs(tableCalcs: readonly string[]): string {
  return UNRELATED_WORKSHEET.replace(
    '<table>',
    `<table><view><datasource-dependencies datasource='Sales'><column-instance column='[Calculation_Other]' derivation='User' name='[usr:Calculation_Other:qk]' pivot='key' type='quantitative'>\n${tableCalcs.join('\n')}\n</column-instance></datasource-dependencies></view>`,
  );
}

function structureInputWithUnrelatedTableCalcs(
  readbackTableCalcs: readonly string[],
  sourceTableCalcs: readonly string[] = UNRELATED_TABLE_CALCS,
): Parameters<typeof verifyRoundStackedBarStructure>[0] {
  const input = structureInput();
  input.sourceWorkbookXml = input.sourceWorkbookXml.replace(
    UNRELATED_WORKSHEET,
    unrelatedWorksheetWithTableCalcs(sourceTableCalcs),
  );
  input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
    UNRELATED_WORKSHEET,
    unrelatedWorksheetWithTableCalcs(readbackTableCalcs),
  );
  return input;
}

function workbook(sheet: string, helpersXml = '', actionsXml = FILTER_ACTIONS): string {
  return `<workbook>
    <document-format-change-manifest />
    <datasources><datasource caption='Friendly Sales' name='Sales'><column name='[Existing]' />${helpersXml}</datasource></datasources>
    ${actionsXml}
    <worksheets>${sheet}${UNRELATED_WORKSHEET}</worksheets>
    <dashboards><dashboard name='Other Dashboard'><zones><zone h='200' id='7' name='Other Worksheet' w='300' x='10' y='20' /></zones><simple-id uuid='{OTHER-DASHBOARD}' /></dashboard><dashboard name='Dashboard'><zones><zone h='200' id='4' name='Orders' w='300' x='10' y='20' /></zones><simple-id uuid='{DASHBOARD}' /></dashboard><dashboard name='Story' type='storyboard'><simple-id uuid='{STORY}' /></dashboard></dashboards>
    <windows><window class='worksheet' name='Orders'><active id='-1' /><simple-id uuid='{WINDOW}' /></window><window class='dashboard' name='Dashboard'><cards><edge name='left'><strip /></edge></cards><simple-id uuid='{DASHBOARD-WINDOW}' /></window></windows>
    <preferences><preference name='show-tabs' value='true' /></preferences>
  </workbook>`;
}

function structureInputForSource(
  source: string,
): Parameters<typeof verifyRoundStackedBarStructure>[0] {
  const plan = planRoundStackedBar(source, { preset: 'subtle' });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.reason);
  const intended = plan.xml;
  return {
    sourceWorksheetXml: source,
    intendedWorksheetXml: intended,
    readbackWorksheetXml: intended,
    sourceWorkbookXml: workbook(source),
    readbackWorkbookXml: workbook(
      intended,
      helperDefinitions(intended, true, Object.keys(plan.semanticContract.helpers).length),
    ),
    contract: plan.semanticContract,
  };
}

function structureInput(): Parameters<typeof verifyRoundStackedBarStructure>[0] {
  return structureInputForSource(sourceWorksheet());
}

function findingCodes(result: ReturnType<typeof verifyRoundStackedBarStructure>): string[] {
  return result.findings.map((finding) => finding.code);
}

describe('verifyRoundStackedBarSourceWorkbook', () => {
  it('refuses an attribute-only top-level actions block', () => {
    const verification = verifyRoundStackedBarSourceWorkbook(
      workbook(sourceWorksheet(), '', "<actions brushing-enabled='true' />"),
      contract,
      sourceWorksheet(),
    );

    expect(verification.ok).toBe(false);
    expect(findingCodes(verification)).toContain('action');
  });

  it.each([
    ['no actions block', ''],
    ['an empty actions block', '<actions />'],
  ])('allows %s', (_label, actionsXml) => {
    expect(
      verifyRoundStackedBarSourceWorkbook(
        workbook(sourceWorksheet(), '', actionsXml),
        contract,
        sourceWorksheet(),
      ),
    ).toEqual({ ok: true, findings: [] });
  });

  it('matches the locked source when its local namespace declaration is inherited from the workbook root', () => {
    const sourceWorkbookXml = workbook(sourceWorksheet(), '', '<actions />')
      .replace(" xmlns:user='http://www.tableausoftware.com/xml/user'", '')
      .replace('<workbook>', "<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>");

    expect(
      verifyRoundStackedBarSourceWorkbook(sourceWorkbookXml, contract, sourceWorksheet()),
    ).toEqual({ ok: true, findings: [] });
  });

  describe('top-level actions', () => {
    const R_ON_D_PREFIX = 'Rounded bars disappear when other sheets on ';
    const R_ON_D_SUFFIX =
      " filter this chart. Remove those filter actions in Dashboard > Actions, or remove 'Orders' from the dashboard, then try again.";
    const GENERIC =
      "This workbook has actions rounded bars can't support yet. Remove them in Dashboard > Actions or Worksheet > Actions, then try again.";
    const OTHER_ZONES = "<zone id='7' name='Other Worksheet' />";

    function dashboardXml(name: string, zones: string, attributes = ''): string {
      return `<dashboard name='${name}'${attributes}><zones>${zones}</zones><simple-id uuid='{${name}}' /></dashboard>`;
    }

    function check(actionsXml: string, dashboardsXml?: string): RoundStackedBarVerification {
      let xml = workbook(sourceWorksheet(), '', actionsXml);
      if (dashboardsXml !== undefined) {
        xml = xml.replace(
          /<dashboards>[\s\S]*?<\/dashboards>/,
          `<dashboards>${dashboardsXml}</dashboards>`,
        );
      }
      return verifyRoundStackedBarSourceWorkbook(xml, contract, sourceWorksheet());
    }

    function messages(verification: ReturnType<typeof check>): string[] {
      return verification.findings.filter((f) => f.code === 'action').map((f) => f.message);
    }

    function expectAccepted(actionsXml: string, dashboardsXml?: string): void {
      expect(check(actionsXml, dashboardsXml)).toEqual({ ok: true, findings: [] });
    }

    function expectRefused(actionsXml: string, dashboardsXml?: string, text = GENERIC): void {
      const verification = check(actionsXml, dashboardsXml);
      expect(verification.ok).toBe(false);
      expect(messages(verification)).toEqual([text]);
    }

    const OTHER = dashboardXml('Other Dashboard', OTHER_ZONES);
    const WITH_R = dashboardXml('Dashboard', "<zone id='4' name='Orders' />");

    it('accepts a generated-shape filter action on a dashboard without the sheet', () => {
      expectAccepted(FILTER_ACTIONS);
    });

    it('accepts several filter actions on several dashboards without the sheet', () => {
      expectAccepted(
        actionsOf(filterAction(), filterAction({ source: 'Third', dashboard: 'Second Dashboard' })),
        `${OTHER}${dashboardXml('Second Dashboard', "<zone id='8' name='Third' />")}${WITH_R}`,
      );
    });

    it('accepts attribute order and quote variants, GUID-suffixed names and exclude params', () => {
      expectAccepted(
        `<actions>
          <action caption="Use Other Worksheet as Filter" name="[Action2_0123456789ABCDEF0123456789ABCDEF]">
            <source dashboard="Other Dashboard" worksheet="Other Worksheet" type="sheet"/>
            <activation auto-clear="true" type="on-select"/>
            <command command="tsc:tsl-filter">
              <param value="Other Dashboard" name="target"/>
              <param name="exclude" value="Other Worksheet"/>
              <param name="on-empty" value="show-all"/>
            </command>
          </action>
        </actions>`,
      );
    });

    it('accepts entity-encoded names that decode to the same dashboard name', () => {
      expectAccepted(
        actionsOf(filterAction({ dashboard: 'Other &amp; Co', target: 'Other &#38; Co' })),
        dashboardXml('Other &#x26; Co', OTHER_ZONES),
      );
    });

    it('clips a long sheet name to 40 characters in the refusal', () => {
      const long = 'Profit by region and customer segment per quarter';
      const sheet = sourceWorksheet().replace("name='Orders'", `name='${long}'`);
      const xml = workbook(sheet, '', FILTER_ACTIONS).replace(
        /<dashboards>[\s\S]*?<\/dashboards>/,
        `<dashboards>${dashboardXml('Other Dashboard', `${OTHER_ZONES}<zone id='4' name='${long}' />`)}</dashboards>`,
      );
      const verification = verifyRoundStackedBarSourceWorkbook(xml, contract, sheet);
      expect(verification.ok).toBe(false);
      expect(messages(verification)).toEqual([
        `${R_ON_D_PREFIX}'Other Dashboard' filter this chart. Remove those filter actions in Dashboard > Actions, or remove '${long.slice(0, 40)}' from the dashboard, then try again.`,
      ]);
    });

    it('refuses with the bounded dashboard list when the sheet is on a target dashboard', () => {
      expectRefused(
        actionsOf(filterAction({ dashboard: 'Dashboard', source: 'Other Worksheet' })),
        `${WITH_R}${OTHER}`,
        `${R_ON_D_PREFIX}'Dashboard'${R_ON_D_SUFFIX}`,
      );
    });

    it('lists at most three dashboards, clipped to 40 characters, then "and N more"', () => {
      const long = 'L'.repeat(60);
      const names = ['Alpha', 'Beta', long, 'Delta', 'Echo'];
      const dashboards = names
        .map((name) => dashboardXml(name, "<zone id='4' name='Orders' />"))
        .join('');
      expectRefused(
        actionsOf(...names.map((name) => filterAction({ dashboard: name }))),
        dashboards,
        `${R_ON_D_PREFIX}'Alpha', 'Beta', '${'L'.repeat(40)}' and 2 more${R_ON_D_SUFFIX}`,
      );
    });

    it.each([
      ['source is the sheet', actionsOf(filterAction({ source: 'Orders' })), undefined],
      [
        'source is the sheet in other case and spacing',
        actionsOf(filterAction({ source: '  ORDERS ' })),
        undefined,
      ],
      [
        'the target differs from the source dashboard',
        actionsOf(filterAction({ target: 'Second Dashboard' })),
        `${OTHER}${dashboardXml('Second Dashboard', '')}`,
      ],
      [
        'a target that differs from the source dashboard only in case and spacing',
        actionsOf(filterAction({ target: ' other DASHBOARD ' })),
        undefined,
      ],
      [
        'a source dashboard that matches a dashboard name only in case',
        actionsOf(filterAction({ dashboard: 'other dashboard' })),
        undefined,
      ],
      [
        'a target dashboard whose name matches another dashboard holding the sheet only in case',
        actionsOf(filterAction({ dashboard: 'DASHBOARD' })),
        `${WITH_R}${dashboardXml('DASHBOARD', OTHER_ZONES)}`,
      ],
      [
        'a target that names the sheet while the source dashboard differs only in case',
        actionsOf(filterAction({ dashboard: 'ORDERS', target: 'Orders' })),
        dashboardXml('ORDERS', OTHER_ZONES),
      ],
      [
        'a target dashboard named like the sheet',
        actionsOf(filterAction({ dashboard: 'Orders' })),
        dashboardXml('Orders', OTHER_ZONES),
      ],
      [
        'the sheet as action param text',
        actionsOf(filterAction({ extra: "<param name='source-sheet'>Orders</param>" })),
        undefined,
      ],
      [
        'the sheet as an action param value',
        actionsOf(filterAction({ extra: "<param name='include' value='Orders' />" })),
        undefined,
      ],
      [
        'the sheet in other case inside action CDATA',
        actionsOf(
          filterAction({ extra: "<param name='source-sheet'><![CDATA[ orders ]]></param>" }),
        ),
        undefined,
      ],
      [
        'a link element',
        actionsOf(filterAction({ extra: "<link expression='http://x' />" })),
        undefined,
      ],
      ['a highlight command', FILTER_ACTIONS.replace('tsc:tsl-filter', 'tsc:brush'), undefined],
      ['a URL command', FILTER_ACTIONS.replace('tsc:tsl-filter', 'tsc:url'), undefined],
      [
        'a nav-action',
        "<actions><nav-action name='n'><source dashboard='Other Dashboard' /></nav-action></actions>",
        undefined,
      ],
      [
        'an edit-parameter-action',
        "<actions><edit-parameter-action name='p' /></actions>",
        undefined,
      ],
      ['an edit-group-action', "<actions><edit-group-action name='g' /></actions>", undefined],
      [
        'two actions blocks',
        `${actionsOf(filterAction())}${actionsOf(filterAction({ name: 'two' }))}`,
        undefined,
      ],
      ['a comment inside', actionsOf('<!-- note -->', filterAction()), undefined],
      ['CDATA inside', actionsOf('<![CDATA[x]]>', filterAction()), undefined],
      ['stray text inside', actionsOf('stray', filterAction()), undefined],
      [
        'an attribute on the block',
        FILTER_ACTIONS.replace('<actions>', "<actions a='b'>"),
        undefined,
      ],
      ['no target param', FILTER_ACTIONS.replace(/<param name='target'[^>]*\/>/, ''), undefined],
      [
        'a target param only under activation',
        FILTER_ACTIONS.replace(/<param name='target'[^>]*\/>/, '').replace(
          "<activation type='on-select' auto-clear='true' />",
          "<activation type='on-select' auto-clear='true'><param name='target' value='Other Dashboard' /></activation>",
        ),
        undefined,
      ],
      [
        'a target param only directly under the action',
        FILTER_ACTIONS.replace(/<param name='target'[^>]*\/>/, '').replace(
          '</command>',
          "</command><param name='target' value='Other Dashboard' />",
        ),
        undefined,
      ],
      [
        'two target params',
        FILTER_ACTIONS.replace(
          '</command>',
          "<param name='target' value='Other Dashboard' /></command>",
        ),
        undefined,
      ],
      ['a missing dashboard', FILTER_ACTIONS, WITH_R],
      ['an ambiguous dashboard', FILTER_ACTIONS, `${OTHER}${OTHER}`],
      [
        'a storyboard marked by type',
        FILTER_ACTIONS,
        dashboardXml('Other Dashboard', OTHER_ZONES, " type='storyboard'"),
      ],
      [
        'a storyboard marked by type-v2',
        FILTER_ACTIONS,
        dashboardXml('Other Dashboard', OTHER_ZONES, " type-v2='storyboard'"),
      ],
      [
        'a zone naming another dashboard',
        FILTER_ACTIONS,
        `${dashboardXml('Other Dashboard', `${OTHER_ZONES}<zone id='9' name='Second Dashboard' />`)}${dashboardXml('Second Dashboard', '')}`,
      ],
      [
        'one valid action mixed with an invalid one',
        actionsOf(filterAction(), filterAction({ name: 'bad', extra: '<link />' })),
        undefined,
      ],
    ])('refuses %s', (_label, actionsXml, dashboardsXml) => {
      expectRefused(actionsXml, dashboardsXml);
    });

    const ACTIVATION = "<activation type='on-select' auto-clear='true' />";
    const SOURCE =
      "<source type='sheet' worksheet='Other Worksheet' dashboard='Other Dashboard' />";
    const COMMAND_OPEN = "<command command='tsc:tsl-filter'>";
    const SPECIAL_FIELDS = "<param name='special-fields' value='all' />";
    const TARGET = "<param name='target' value='Other Dashboard' />";
    const COMMAND = `${COMMAND_OPEN}${TARGET}</command>`;

    it.each([
      ['an unknown source type', FILTER_ACTIONS.replace("type='sheet'", "type='bogus'")],
      ['a missing source type', FILTER_ACTIONS.replace("<source type='sheet' ", '<source ')],
      ['a datasource source type', FILTER_ACTIONS.replace("type='sheet'", "type='datasource'")],
      ['an all source type', FILTER_ACTIONS.replace("type='sheet'", "type='all'")],
      [
        'an unknown source attribute',
        FILTER_ACTIONS.replace('<source ', "<source datasource='Sales' "),
      ],
      [
        'an unknown child of the action',
        FILTER_ACTIONS.replace('<activation', '<note /><activation'),
      ],
      ['an unknown action attribute', FILTER_ACTIONS.replace('<action ', "<action extra='x' ")],
      ['an unknown activation type', FILTER_ACTIONS.replace("type='on-select'", "type='on-drag'")],
      [
        'an unknown activation attribute',
        FILTER_ACTIONS.replace(ACTIVATION, "<activation type='on-select' delay='1' />"),
      ],
      [
        'a child inside the activation',
        FILTER_ACTIONS.replace(
          ACTIVATION,
          "<activation type='on-select' auto-clear='true'><note /></activation>",
        ),
      ],
      [
        'an unknown source child',
        FILTER_ACTIONS.replace(
          "dashboard='Other Dashboard' />",
          "dashboard='Other Dashboard'><exclude-field name='Category' /></source>",
        ),
      ],
      [
        'an exclude-sheet with an extra attribute',
        FILTER_ACTIONS.replace(
          "dashboard='Other Dashboard' />",
          "dashboard='Other Dashboard'><exclude-sheet name='Other Worksheet' scope='x' /></source>",
        ),
      ],
      [
        'an exclude-sheet with a child',
        FILTER_ACTIONS.replace(
          "dashboard='Other Dashboard' />",
          "dashboard='Other Dashboard'><exclude-sheet name='Other Worksheet'><note /></exclude-sheet></source>",
        ),
      ],
      [
        'an unknown command attribute',
        FILTER_ACTIONS.replace(COMMAND_OPEN, "<command command='tsc:tsl-filter' scope='x'>"),
      ],
      [
        'an unknown param name',
        actionsOf(filterAction({ extra: "<param name='include' value='Other Worksheet' />" })),
      ],
      ['a duplicate param', actionsOf(filterAction({ extra: SPECIAL_FIELDS }))],
      [
        'text inside a param',
        FILTER_ACTIONS.replace(
          SPECIAL_FIELDS,
          "<param name='special-fields' value='all'>x</param>",
        ),
      ],
      [
        'a param without a value',
        FILTER_ACTIONS.replace(SPECIAL_FIELDS, "<param name='special-fields' />"),
      ],
      [
        'a param with an extra attribute',
        FILTER_ACTIONS.replace(SPECIAL_FIELDS, "<param name='special-fields' value='all' x='y' />"),
      ],
      [
        'a param inside a param',
        actionsOf(
          filterAction({ extra: `<param name='on-empty' value='none'>${SPECIAL_FIELDS}</param>` }),
        ),
      ],
      ['two activations', FILTER_ACTIONS.replace(ACTIVATION, `${ACTIVATION}${ACTIVATION}`)],
      [
        'a comment inside the action',
        FILTER_ACTIONS.replace(ACTIVATION, `<!-- c -->${ACTIVATION}`),
      ],
      ['CDATA inside the command', actionsOf(filterAction({ extra: '<![CDATA[x]]>' }))],
      [
        'stray text inside the source',
        FILTER_ACTIONS.replace(
          "dashboard='Other Dashboard' />",
          "dashboard='Other Dashboard'>x</source>",
        ),
      ],
      ['zero sources', actionsOf(`<action name='a'>${ACTIVATION}${COMMAND}</action>`)],
      [
        'two sources',
        actionsOf(`<action name='a'>${ACTIVATION}${SOURCE}${SOURCE}${COMMAND}</action>`),
      ],
      ['zero commands', actionsOf(`<action name='a'>${ACTIVATION}${SOURCE}</action>`)],
      [
        'two commands',
        actionsOf(`<action name='a'>${ACTIVATION}${SOURCE}${COMMAND}${COMMAND}</action>`),
      ],
    ])('refuses a filter action outside the Desktop grammar: %s', (_label, actionsXml) => {
      expect(actionsXml).not.toEqual(FILTER_ACTIONS);
      expectRefused(actionsXml);
    });

    const DESKTOP_DASHBOARD_ACTION =
      "<action caption='Click to filter (D)' name='[Action2]'><activation auto-clear='true' type='on-select' /><source dashboard='D' type='sheet' /><command command='tsc:tsl-filter'><param name='special-fields' value='all' /><param name='target' value='D' /></command></action>";
    const D_DASHBOARDS = `${dashboardXml('D', `${OTHER_ZONES}<zone id='8' name='Sales KPI' />`)}${WITH_R}`;
    const LIVE_SOURCE_SHEET_ACTION =
      "<action caption='Filter map by Sales by Region' name='[Action3]'> <activation auto-clear='true' type='on-select' /> <source dashboard='Sales &amp; Profit Overview' type='sheet' worksheet='Sales by Region (Ranked)' /> <command command='tsc:tsl-filter'> <param name='exclude' value='Sales by Region (Ranked),Profit by Segment (Ranked)' /> <param name='special-fields' value='all' /> <param name='target' value='Sales &amp; Profit Overview' /> </command> </action>";
    const LIVE_ZONES =
      "<zone id='1' name='Sales by Region (Ranked)' /><zone id='2' name='Profit by Segment (Ranked)' />";

    it.each([
      ['the exact Desktop-written dashboard-source shape', DESKTOP_DASHBOARD_ACTION, D_DASHBOARDS],
      [
        'the Desktop-written shape with exclude-sheet children',
        DESKTOP_DASHBOARD_ACTION.replace(
          "<source dashboard='D' type='sheet' />",
          "<source dashboard='D' type='sheet'><exclude-sheet name='Sales KPI' /></source>",
        ),
        D_DASHBOARDS,
      ],
      [
        'the click-to-filter shape author-action writes with KPI exclude-sheet children',
        "<action caption='Click to filter (D)' name='[Action1_0123456789ABCDEF0123456789ABCDEF]'><activation auto-clear='true' type='on-select' /><source type='sheet' dashboard='D'><exclude-sheet name='Sales KPI' /><exclude-sheet name='Profit KPI' /></source><command command='tsc:tsl-filter'><param name='special-fields' value='all' /><param name='target' value='D' /></command></action>",
        `${dashboardXml('D', `${OTHER_ZONES}<zone id='8' name='Sales KPI' /><zone id='9' name='Profit KPI' />`)}${WITH_R}`,
      ],
      [
        'no activation type',
        DESKTOP_DASHBOARD_ACTION.replace(" type='on-select'", ''),
        D_DASHBOARDS,
      ],
      [
        'no activation',
        DESKTOP_DASHBOARD_ACTION.replace("<activation auto-clear='true' type='on-select' />", ''),
        D_DASHBOARDS,
      ],
      ['on-hover', DESKTOP_DASHBOARD_ACTION.replace('on-select', 'on-hover'), D_DASHBOARDS],
      ['explicit', DESKTOP_DASHBOARD_ACTION.replace('on-select', 'explicit'), D_DASHBOARDS],
      [
        "enabled='false'",
        DESKTOP_DASHBOARD_ACTION.replace('<action ', "<action enabled='false' "),
        D_DASHBOARDS,
      ],
      [
        'single-select and on-empty params',
        DESKTOP_DASHBOARD_ACTION.replace(
          "<param name='special-fields'",
          "<param name='on-empty' value='none' /><param name='single-select' value='' /><param name='special-fields'",
        ),
        D_DASHBOARDS,
      ],
      [
        'live pretty-printed source-sheet output',
        LIVE_SOURCE_SHEET_ACTION,
        `${dashboardXml('Sales &amp; Profit Overview', LIVE_ZONES)}${WITH_R}`,
      ],
    ])('accepts %s on a dashboard without the sheet', (_label, action, dashboardsXml) => {
      expectAccepted(actionsOf(action), dashboardsXml);
    });

    it.each([
      ['its exclude param leaves the sheet out', LIVE_SOURCE_SHEET_ACTION],
      [
        'its exclude param lists the sheet',
        LIVE_SOURCE_SHEET_ACTION.replace(
          "value='Sales by Region (Ranked),Profit by Segment (Ranked)'",
          "value='Sales by Region (Ranked),Orders'",
        ),
      ],
    ])(
      'refuses live source-sheet output on a dashboard holding the sheet when %s',
      (_label, action) => {
        expectRefused(
          actionsOf(action),
          dashboardXml('Sales &amp; Profit Overview', `${LIVE_ZONES}<zone id='4' name='Orders' />`),
          `${R_ON_D_PREFIX}'Sales & Profit Overview'${R_ON_D_SUFFIX}`,
        );
      },
    );

    it.each([
      ['reaching first', (reaching: string, brush: string) => actionsOf(reaching, brush)],
      ['highlight first', (reaching: string, brush: string) => actionsOf(brush, reaching)],
    ])(
      'prefers the generic refusal when a reaching filter mixes with a highlight action, %s',
      (_label, order) => {
        const reaching = filterAction({ dashboard: 'Dashboard', name: 'reach' });
        const brush = filterAction({ name: 'brush' }).replace('tsc:tsl-filter', 'tsc:brush');
        expectRefused(order(reaching, brush), `${WITH_R}${OTHER}`);
      },
    );

    it.each([
      [
        'a nested container',
        "<zone id='1'><zone id='2'><zone id='3' name='Orders' /></zone></zone>",
      ],
      ['different case and spacing', "<zone id='4' name='  oRDERS ' />"],
      [
        'a device layout',
        "<devicelayouts><devicelayout><zones><zone id='4' name='Orders' /></zones></devicelayout></devicelayouts>",
      ],
      [
        'a story point captured-sheet',
        "<story-points><story-point captured-sheet='Orders' /></story-points>",
      ],
    ])('refuses when the target dashboard holds the sheet in %s', (_label, inner) => {
      const dashboard = `<dashboard name='Other Dashboard'><zones>${OTHER_ZONES}</zones>${inner}<simple-id uuid='{X}' /></dashboard>`;
      expectRefused(FILTER_ACTIONS, dashboard, `${R_ON_D_PREFIX}'Other Dashboard'${R_ON_D_SUFFIX}`);
    });

    it('fails closed when the sheet identity is unresolved while actions exist', () => {
      const verification = verifyRoundStackedBarSourceWorkbook(
        workbook(sourceWorksheet().replace(WORKSHEET_ID, '{OTHER}')),
        contract,
        sourceWorksheet(),
      );
      expect(verification.ok).toBe(false);
      expect(messages(verification)).toEqual([GENERIC]);
    });

    it('never mentions deleting an action through the author tools', () => {
      expect(R_ON_D_SUFFIX + GENERIC).not.toMatch(/author/i);
    });

    it('passes structure readback with accepted actions unchanged', () => {
      expect(verifyRoundStackedBarStructure(structureInput())).toEqual({ ok: true, findings: [] });
    });

    it.each([
      ['drops', (xml: string) => xml.replace(FILTER_ACTIONS, '<actions />')],
      [
        'duplicates',
        (xml: string) => xml.replace(FILTER_ACTIONS, actionsOf(filterAction(), filterAction())),
      ],
      ['edits', (xml: string) => xml.replace("auto-clear='true'", "auto-clear='false'")],
    ])('flags workbook-identity when the readback %s an action', (_label, mutate) => {
      const input = structureInput();
      input.readbackWorkbookXml = mutate(input.readbackWorkbookXml);
      expect(input.readbackWorkbookXml).not.toEqual(structureInput().readbackWorkbookXml);
      expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
    });
  });

  it.each([
    ['missing', workbook(sourceWorksheet().replace(WORKSHEET_ID, '{OTHER}'), '', FILTER_ACTIONS)],
    [
      'ambiguous',
      workbook(
        `${sourceWorksheet()}${sourceWorksheet().replace("name='Orders'", "name='Orders Copy'")}`,
        '',
        FILTER_ACTIONS,
      ),
    ],
  ])('fails closed when the target worksheet identity is %s', (_label, sourceWorkbookXml) => {
    const verification = verifyRoundStackedBarSourceWorkbook(
      sourceWorkbookXml,
      contract,
      sourceWorksheet(),
    );

    expect(verification.ok).toBe(false);
    expect(findingCodes(verification)).toContain('workbook-identity');
  });

  it.each([
    [
      'missing',
      workbook(sourceWorksheet()).replace(
        "<datasource caption='Friendly Sales' name='Sales'><column name='[Existing]' /></datasource>",
        "<datasource name='Other' />",
      ),
    ],
    [
      'duplicated',
      workbook(sourceWorksheet()).replace(
        '</datasources>',
        "<datasource caption='Duplicate' name='Sales' /></datasources>",
      ),
    ],
  ])('fails closed when the target datasource is %s', (_label, sourceWorkbookXml) => {
    const verification = verifyRoundStackedBarSourceWorkbook(
      sourceWorkbookXml,
      contract,
      sourceWorksheet(),
    );

    expect(verification.ok).toBe(false);
    expect(findingCodes(verification)).toContain('workbook-identity');
  });
});

describe('captureRoundStackedBarBaseline', () => {
  it('captures shuffled simple-bar summary columns without inventing a Segment key', () => {
    const captured = captureRoundStackedBarBaseline(simpleSummary(), simpleContract);

    expect(captured).toEqual({
      ok: true,
      baseline: {
        worksheetId: WORKSHEET_ID,
        groups: [
          { category: 'Alpha', value: 12 },
          { category: 'Beta', value: -8 },
        ],
        segmentOrderFromZero: [],
        expectedVertexRows: 24,
        categoryVisualOrder: 'live-only',
      },
    });
  });

  it('resolves shuffled columns, ignores extra tooltip columns, and never treats row order as visual order', () => {
    const result = captureRoundStackedBarBaseline(
      { ...summary(), rows: [...summary().rows].reverse() },
      contract,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseline.groups).toHaveLength(5);
    expect(result.baseline.expectedVertexRows).toBe(60);
    expect(result.baseline.segmentOrderFromZero).toEqual(['Home Office', 'Corporate', 'Consumer']);
    expect(result.baseline.categoryVisualOrder).toBe('live-only');
  });

  it('normalizes finite numeric and boolean nominal keys from summary data', () => {
    expect(
      captureRoundStackedBarBaseline(
        summary([
          [2024, true, 10],
          [2025, false, -8],
        ]),
        contract,
      ),
    ).toEqual({
      ok: true,
      baseline: {
        worksheetId: WORKSHEET_ID,
        groups: [
          { category: '2024', segment: 'true', value: 10 },
          { category: '2025', segment: 'false', value: -8 },
        ],
        segmentOrderFromZero: ['true', 'false'],
        expectedVertexRows: 24,
        categoryVisualOrder: 'live-only',
      },
    });
  });

  it.each([
    ['wrong worksheet', { ...summary(), worksheet: { id: '{OTHER}' } }, /worksheet/i],
    ['null key', summary([['Alpha', null, 1]]), /null/i],
    ['zero value', summary([['Alpha', 'Consumer', 0]]), /nonzero/i],
    ['nonfinite value', summary([['Alpha', 'Consumer', Number.POSITIVE_INFINITY]]), /finite/i],
    [
      'duplicate key',
      summary([
        ['Alpha', 'Consumer', 1],
        ['Alpha', 'Consumer', 2],
      ]),
      /duplicate/i,
    ],
    [
      '84 groups',
      summary(Array.from({ length: 84 }, (_, index) => [`C${index}`, 'Consumer', 1])),
      /83/i,
    ],
  ])('refuses %s', (_label, data, pattern) => {
    const result = captureRoundStackedBarBaseline(data as TabularData, contract);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(pattern as RegExp);
  });
});

describe('verifyRoundStackedBarSeedEvidence', () => {
  it('validates simple-bar seed evidence without requesting or resolving Segment', () => {
    expect(
      verifyRoundStackedBarSeedEvidence(simpleRawData(), captureSimpleBaseline(), simpleContract),
    ).toEqual({ ok: true, findings: [] });

    const oneSeed = simpleRawData();
    oneSeed.rows = oneSeed.rows.filter((_row, index) => index !== 1);
    expect(
      verifyRoundStackedBarSeedEvidence(oneSeed, captureSimpleBaseline(), simpleContract).findings,
    ).toContainEqual(expect.objectContaining({ code: 'seed-evidence' }));
  });

  it('matches finite numeric and boolean nominal keys across underlying data', () => {
    const baseline: RoundStackedBarBaseline = {
      worksheetId: WORKSHEET_ID,
      groups: [
        { category: '2024', segment: 'true', value: 10 },
        { category: '2025', segment: 'false', value: -8 },
      ],
      segmentOrderFromZero: ['true', 'false'],
      expectedVertexRows: 24,
      categoryVisualOrder: 'live-only',
    };
    const underlying = rawData([
      [true, 'West', 4, 2024],
      [true, 'West', 6, 2024],
      [false, 'West', -3, 2025],
      [false, 'West', -5, 2025],
    ]);

    expect(verifyRoundStackedBarSeedEvidence(underlying, baseline, contract)).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('requires two distinct finite raw values for every visible group and the requested filter member', () => {
    expect(verifyRoundStackedBarSeedEvidence(rawData(), captureBaseline(), contract).ok).toBe(true);

    const oneValue = rawData().rows.filter((_row, index) => index !== 1);
    const missingSeed = verifyRoundStackedBarSeedEvidence(
      rawData(oneValue),
      captureBaseline(),
      contract,
    );
    expect(missingSeed.ok).toBe(false);
    expect(missingSeed.findings.map((finding) => finding.code)).toContain('seed-evidence');

    const wrongFilter = rawData().rows.map((row) => [...row]);
    wrongFilter[0][1] = 'East';
    const filterResult = verifyRoundStackedBarSeedEvidence(
      rawData(wrongFilter),
      captureBaseline(),
      contract,
    );
    expect(filterResult.ok).toBe(false);
    expect(filterResult.findings.map((finding) => finding.code)).toContain('filter');
  });

  it('resolves the underlying filter by its source column when the caption differs', () => {
    const technicalFilterContract: RoundStackedBarSemanticContract = {
      ...contract,
      filter: {
        ...contract.filter!,
        caption: 'Sales Territory',
        column: '[Region Code]',
      },
    };
    const underlying = rawData();
    underlying.columns = underlying.columns.map((column) =>
      (column as { name: string }).name === 'Region' ? { name: 'Region Code' } : column,
    );

    expect(
      verifyRoundStackedBarSeedEvidence(underlying, captureBaseline(), technicalFilterContract),
    ).toEqual({ ok: true, findings: [] });
  });

  it.each([
    ['number', '2024', 2024],
    ['boolean true', 'true', true],
    ['boolean false', 'false', false],
  ])('accepts a native %s filter value matching the XML member', (_label, member, value) => {
    const scalarContract: RoundStackedBarSemanticContract = {
      ...contract,
      filter: { ...contract.filter!, member },
    };
    const underlying = rawData(rawData().rows.map((row) => [row[0], value, row[2], row[3]]));

    expect(
      verifyRoundStackedBarSeedEvidence(underlying, captureBaseline(), scalarContract),
    ).toEqual({ ok: true, findings: [] });
  });

  it.each([
    ['different numeric spelling', '01', 1],
    ['different boolean spelling', 'TRUE', true],
    ['null', 'null', null],
    ['undefined', 'undefined', undefined],
    ['NaN', 'NaN', Number.NaN],
    ['positive infinity', 'Infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', '-Infinity', Number.NEGATIVE_INFINITY],
    ['object', '[object Object]', { value: 'West' }],
  ])('rejects %s instead of coercing it to the XML member', (_label, member, value) => {
    const scalarContract: RoundStackedBarSemanticContract = {
      ...contract,
      filter: { ...contract.filter!, member },
    };
    const underlying = rawData(rawData().rows.map((row) => [row[0], value, row[2], row[3]]));

    const verification = verifyRoundStackedBarSeedEvidence(
      underlying,
      captureBaseline(),
      scalarContract,
    );

    expect(verification.ok).toBe(false);
    expect(verification.findings).toContainEqual(expect.objectContaining({ code: 'filter' }));
  });

  it.each([
    ['null', null],
    ['blank', ''],
    ['whitespace-only', '   '],
    ['boolean false', false],
    ['boolean true', true],
  ])('does not accept %s as a numeric raw measure seed', (_label, invalidValue) => {
    const rows = rawData().rows.map((row) => [...row]);
    rows[0][2] = invalidValue;
    rows[1][2] = 5;

    const verification = verifyRoundStackedBarSeedEvidence(
      rawData(rows),
      captureBaseline(),
      contract,
    );

    expect(verification.ok).toBe(false);
    expect(verification.findings).toContainEqual(
      expect.objectContaining({ code: 'seed-evidence' }),
    );
  });

  it.each([
    ['number', 0, 5],
    ['numeric string', '0', '5'],
  ])('preserves a legitimate %s zero as a distinct raw seed', (_label, zero, finite) => {
    const rows = rawData().rows.map((row) => [...row]);
    rows[0][2] = zero;
    rows[1][2] = finite;

    expect(verifyRoundStackedBarSeedEvidence(rawData(rows), captureBaseline(), contract)).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('accepts datasource-qualified underlying-data column names without hiding ambiguity', () => {
    const qualified = rawData();
    qualified.columns = qualified.columns.map((column) => ({
      name: `[Friendly Sales].[${(column as { name: string }).name}]`,
    }));
    expect(verifyRoundStackedBarSeedEvidence(qualified, captureBaseline(), contract)).toEqual({
      ok: true,
      findings: [],
    });

    qualified.columns = [...qualified.columns, { name: '[Other].[Profit]' }];
    qualified.rows = qualified.rows.map((row) => [...row, row[2]]);
    expect(verifyRoundStackedBarSeedEvidence(qualified, captureBaseline(), contract)).toEqual({
      ok: true,
      findings: [],
    });

    qualified.columns = [...qualified.columns, { name: '[Sales].[Profit]' }];
    qualified.rows = qualified.rows.map((row) => [...row, row[2]]);
    const ambiguous = verifyRoundStackedBarSeedEvidence(qualified, captureBaseline(), contract);
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.findings.map((finding) => finding.code)).toContain('seed-evidence');
  });
});

describe('verifyRoundStackedBarPostSummary', () => {
  it.each([
    ['a null zero coordinate', 4, 0, null, 'segment-value'],
    ['a blank zero coordinate', 4, 0, '   ', 'segment-value'],
    ['a boolean zero coordinate', 4, 0, false, 'segment-value'],
    ['a null zero frame', 5, 0, null, 'frame-domain'],
    ['a boolean first path', 2, 1, true, 'path-domain'],
  ] as const)(
    'rejects %s instead of coercing it into valid polygon geometry',
    (_label, columnIndex, originalValue, malformedValue, expectedCode) => {
      const malformed = polygonSummary();
      const rows = malformed.rows.map((row) => [...row]);
      const rowIndex = rows.findIndex((row) => row[columnIndex] === originalValue);
      expect(rowIndex).toBeGreaterThanOrEqual(0);
      rows[rowIndex][columnIndex] = malformedValue;
      malformed.rows = rows;

      const verification = verifyRoundStackedBarPostSummary(malformed, captureBaseline(), contract);

      expect(verification.ok).toBe(false);
      expect(verification.findings.map((finding) => finding.code)).toContain(expectedCode);
    },
  );

  it('accepts finite numeric strings for polygon geometry', () => {
    const readback = polygonSummary();
    const numericColumns = new Set([0, 2, 4, 5]);
    readback.rows = readback.rows.map((row) =>
      row.map((cell, index) => (numericColumns.has(index) ? String(cell) : cell)),
    );

    expect(verifyRoundStackedBarPostSummary(readback, captureBaseline(), contract)).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('matches finite numeric and boolean nominal keys across post-apply summary data', () => {
    const baseline: RoundStackedBarBaseline = {
      worksheetId: WORKSHEET_ID,
      groups: [
        { category: '2024', segment: 'true', value: 10 },
        { category: '2025', segment: 'false', value: -8 },
      ],
      segmentOrderFromZero: ['true', 'false'],
      expectedVertexRows: 24,
      categoryVisualOrder: 'live-only',
    };
    const readback = polygonSummary(
      [
        { category: '2024', segment: 'true', low: 0, high: 10, roundTop: true },
        { category: '2025', segment: 'false', low: -8, high: 0, roundBottom: true },
      ],
      { '2024': 10, '2025': 8 },
    );
    readback.rows = readback.rows.map((row) => [
      row[0],
      row[1] === 'true',
      row[2],
      Number(row[3]),
      ...row.slice(4),
    ]);

    expect(verifyRoundStackedBarPostSummary(readback, baseline, contract)).toEqual({
      ok: true,
      findings: [],
    });
  });

  it('verifies horizontal simple bars after normalizing the band and value axes', () => {
    expect(
      verifyRoundStackedBarPostSummary(
        swapGeometryAxes(simplePolygonSummary(), 4, 2),
        captureSimpleBaseline(),
        { ...simpleContract, orientation: 'horizontal' },
      ),
    ).toEqual({ ok: true, findings: [] });
  });

  it('verifies horizontal stacked bars after normalizing the band and value axes', () => {
    expect(
      verifyRoundStackedBarPostSummary(
        swapGeometryAxes(polygonSummary(), 0, 4),
        captureBaseline(),
        { ...contract, orientation: 'horizontal' },
      ),
    ).toEqual({ ok: true, findings: [] });
  });

  it('verifies positive and negative simple bars from zero with only the nonzero tip rounded', () => {
    expect(
      verifyRoundStackedBarPostSummary(
        simplePolygonSummary(),
        captureSimpleBaseline(),
        simpleContract,
      ),
    ).toEqual({ ok: true, findings: [] });
  });

  it('rejects a shifted simple bar even when its value span and rounded tip are unchanged', () => {
    const shifted = simplePolygonSummary([
      { category: 'Alpha', segment: '', low: 1, high: 13, roundTop: true },
      { category: 'Beta', segment: '', low: -8, high: 0, roundBottom: true },
    ]);

    const verification = verifyRoundStackedBarPostSummary(
      shifted,
      captureSimpleBaseline(),
      simpleContract,
    );

    expect(verification.ok).toBe(false);
    expect(verification.findings).toContainEqual(
      expect.objectContaining({ code: 'segment-value' }),
    );
  });

  it('verifies positive and negative simple bars whose rounded tips are just above the zero gate', () => {
    const readback = simplePolygonSummary([
      { category: 'Alpha', segment: '', low: 0, high: 1e-5, roundTop: true },
      { category: 'Beta', segment: '', low: -1e-5, high: 0, roundBottom: true },
    ]);

    expect(
      verifyRoundStackedBarPostSummary(readback, tinySimpleBaseline(), simpleContract),
    ).toEqual({ ok: true, findings: [] });
  });

  it('still rejects a tiny simple bar whose nonzero tip is square instead of rounded', () => {
    const squareTips = simplePolygonSummary([
      { category: 'Alpha', segment: '', low: 0, high: 1e-5 },
      { category: 'Beta', segment: '', low: -1e-5, high: 0 },
    ]);

    const verification = verifyRoundStackedBarPostSummary(
      squareTips,
      tinySimpleBaseline(),
      simpleContract,
    );

    expect(verification.ok).toBe(false);
    expect(verification.findings).toContainEqual(expect.objectContaining({ code: 'outer-tip' }));
  });

  it('treats a one-member colored bar as a stack because Segment remains in the contract', () => {
    const oneMemberSummary = summary([
      ['Alpha', 'Consumer', 10],
      ['Beta', 'Consumer', -8],
    ]);
    const shiftedStack = polygonSummary(
      [
        { category: 'Alpha', segment: 'Consumer', low: 1, high: 11, roundTop: true },
        { category: 'Beta', segment: 'Consumer', low: -8, high: 0, roundBottom: true },
      ],
      { Alpha: 10, Beta: 8 },
    );

    const verification = verifyRoundStackedBarPostSummary(
      shiftedStack,
      captureBaseline(oneMemberSummary),
      contract,
    );

    expect(verification.findings).toContainEqual(
      expect.objectContaining({ code: 'stack-gap-or-overlap' }),
    );
  });

  it('accepts unordered 12-row polygons and extra summary columns', () => {
    const result = verifyRoundStackedBarPostSummary(polygonSummary(), captureBaseline(), contract);
    expect(result).toEqual({ ok: true, findings: [] });
  });

  it('verifies positive and negative stacks independently within one category', () => {
    const mixedGroups = [
      ['Mixed', 'D', 3],
      ['Mixed', 'C', 5],
      ['Mixed', 'B', -4],
      ['Mixed', 'A', -6],
    ] as const;
    const mixedIntervals: Interval[] = [
      { category: 'Mixed', segment: 'D', low: 0, high: 3 },
      { category: 'Mixed', segment: 'C', low: 3, high: 8, roundTop: true },
      { category: 'Mixed', segment: 'B', low: -4, high: 0 },
      { category: 'Mixed', segment: 'A', low: -10, high: -4, roundBottom: true },
    ];

    expect(
      verifyRoundStackedBarPostSummary(
        polygonSummary(mixedIntervals, { Mixed: 18 }),
        captureBaseline(summary(mixedGroups)),
        contract,
      ),
    ).toEqual({ ok: true, findings: [] });
  });

  it('rejects the minimized live reversal even when spans and outer tips are otherwise correct', () => {
    const reversed = [
      { category: 'Alpha', segment: 'Consumer', low: 0, high: 10 },
      { category: 'Alpha', segment: 'Corporate', low: 10, high: 30 },
      { category: 'Alpha', segment: 'Home Office', low: 30, high: 60, roundTop: true },
      ...goodIntervals().filter((interval) => interval.category === 'Beta'),
    ];
    const result = verifyRoundStackedBarPostSummary(
      polygonSummary(reversed),
      captureBaseline(),
      contract,
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('stack-order');
  });

  it('rejects missing/duplicate domains, wrong spans, gaps, and missing groups', () => {
    const baseline = captureBaseline();
    const missingFrame = polygonSummary();
    missingFrame.rows = missingFrame.rows.slice(1);
    expect(
      verifyRoundStackedBarPostSummary(missingFrame, baseline, contract).findings.map(
        (finding) => finding.code,
      ),
    ).toContain('frame-domain');

    const wrongSpan = goodIntervals();
    wrongSpan[0] = { ...wrongSpan[0], high: 29 };
    expect(
      verifyRoundStackedBarPostSummary(polygonSummary(wrongSpan), baseline, contract).findings.map(
        (finding) => finding.code,
      ),
    ).toEqual(expect.arrayContaining(['segment-value', 'stack-gap-or-overlap']));

    expect(
      verifyRoundStackedBarPostSummary(
        polygonSummary(goodIntervals().slice(1)),
        baseline,
        contract,
      ).findings.map((finding) => finding.code),
    ).toContain('summary-groups');
  });

  it('rejects a rounded internal join and a square outer tip', () => {
    const internalRounded = goodIntervals();
    internalRounded[0] = { ...internalRounded[0], roundTop: true };
    const internalResult = verifyRoundStackedBarPostSummary(
      polygonSummary(internalRounded),
      captureBaseline(),
      contract,
    );
    expect(internalResult.findings.map((finding) => finding.code)).toContain('internal-join');

    const squareOuter = goodIntervals();
    squareOuter[2] = { ...squareOuter[2], roundTop: false };
    const outerResult = verifyRoundStackedBarPostSummary(
      polygonSummary(squareOuter),
      captureBaseline(),
      contract,
    );
    expect(outerResult.findings.map((finding) => finding.code)).toContain('outer-tip');
  });

  it('rejects collapsed or otherwise non-canonical 12-point X geometry', () => {
    const collapsed = polygonSummary();
    collapsed.rows = collapsed.rows.map((row) => [0, ...row.slice(1)]);
    const result = verifyRoundStackedBarPostSummary(collapsed, captureBaseline(), contract);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('segment-value');
  });

  it('rejects a rounded tip whose Y radius is larger than the subtle preset', () => {
    const oversized = goodIntervals();
    oversized[2] = { ...oversized[2], radiusScale: 2 };
    const result = verifyRoundStackedBarPostSummary(
      polygonSummary(oversized),
      captureBaseline(),
      contract,
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('segment-value');
  });
});

describe('verifyRoundStackedBarStructure', () => {
  it('accepts a stacked Polygon with exactly its 18 contract helpers', () => {
    expect(verifyRoundStackedBarStructure(structureInput())).toEqual({ ok: true, findings: [] });
  });

  it('accepts a simple Polygon with exactly its 14 active contract helpers', () => {
    const input = structureInputForSource(simpleSourceWorksheet());

    expect(Object.keys(input.contract.helpers)).toHaveLength(14);
    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });
  });

  it.each(['missing', 'extra'] as const)(
    'rejects a simple Polygon with an %s helper outside its exact active set',
    (mutation) => {
      const input = structureInputForSource(simpleSourceWorksheet());
      const helpers = helperDefinitions(input.intendedWorksheetXml, true, 14);
      const firstHelper = helpers.match(/<column\b[\s\S]*?<\/column>/)?.[0];
      expect(firstHelper).toBeTruthy();
      const changedHelpers =
        mutation === 'missing'
          ? helpers.replace(firstHelper ?? '', '')
          : `${helpers}<column hidden='true' name='[${PREFIX}pos]'><calculation class='tableau' formula='0' /></column>`;
      input.readbackWorkbookXml = workbook(input.readbackWorksheetXml, changedHelpers);

      expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('helper-definition');
    },
  );

  it('requires the supplied semantic contract to match the deterministic source plan', () => {
    const input = structureInput();
    input.contract = {
      ...input.contract,
      datasource: { ...input.contract.datasource, caption: 'Wrong datasource caption' },
    };

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('worksheet-content');
  });

  it('accepts host indentation outside narration runs in standalone and workbook readback', () => {
    const input = structureInput();
    const hostReadback = prettyPrintNarrationOwners(input.intendedWorksheetXml);
    expect(hostReadback).not.toBe(input.intendedWorksheetXml);
    input.readbackWorksheetXml = hostReadback;
    input.readbackWorkbookXml = workbook(hostReadback, helperDefinitions(hostReadback));

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });
  });

  it('rejects semantic text drift hidden inside host-formatted narration', () => {
    const input = structureInput();
    const hostReadback = prettyPrintNarrationOwners(input.intendedWorksheetXml).replaceAll(
      'Sum of Profit',
      'Sum of Profits',
    );
    expect(hostReadback).not.toBe(input.intendedWorksheetXml);
    input.readbackWorksheetXml = hostReadback;
    input.readbackWorkbookXml = workbook(hostReadback, helperDefinitions(hostReadback));

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('worksheet-content');
  });

  it('accepts the live host closure, declaration, axis-grouping, and table-calc-order normalization', () => {
    const input = structureInput();
    const hostReadback = tableauHostRoundedReadback(input.intendedWorksheetXml);
    input.readbackWorksheetXml = hostReadback;
    input.readbackWorkbookXml = workbook(hostReadback, helperDefinitions(hostReadback));

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });
  });

  it('accepts a standalone local namespace declaration inherited from the workbook root when embedded', () => {
    const input = structureInput();
    const inheritUserNamespace = (xml: string): string =>
      xml
        .replace(" xmlns:user='http://www.tableausoftware.com/xml/user'", '')
        .replace('<workbook>', "<workbook xmlns:user='http://www.tableausoftware.com/xml/user'>");
    input.sourceWorkbookXml = inheritUserNamespace(input.sourceWorkbookXml);
    input.readbackWorkbookXml = inheritUserNamespace(input.readbackWorkbookXml);

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });

    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      "<worksheet name='Orders'>",
      "<worksheet bogus='true' name='Orders'>",
    );
    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('rejects complete standalone readback drift even when the embedded readback agrees', () => {
    const input = structureInputForSource(sourceWorksheetWithPreservedContent());
    const changed = input.readbackWorksheetXml.replace(
      "selection-relaxation-option='selection-relaxation-allow'",
      "selection-relaxation-option='selection-relaxation-disallow'",
    );
    expect(changed).not.toBe(input.readbackWorksheetXml);
    input.readbackWorksheetXml = changed;
    input.readbackWorkbookXml = workbook(changed, helperDefinitions(changed));

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('worksheet-content');
  });

  it.each([
    [
      'preserved pane attributes',
      (xml: string) =>
        xml.replace(
          "selection-relaxation-option='selection-relaxation-allow'",
          "selection-relaxation-option='selection-relaxation-disallow'",
        ),
    ],
    [
      'preserved pane view breakdown',
      (xml: string) => xml.replace("<breakdown value='auto' />", "<breakdown value='manual' />"),
    ],
    [
      'preserved repository location',
      (xml: string) =>
        xml.replace(
          "derived-from='https://example.invalid/kept'",
          "derived-from='https://example.invalid/changed'",
        ),
    ],
    [
      'preserved original dependency metadata',
      (xml: string) => xml.replace("original='[Category]'", "original='[Changed Category]'"),
    ],
    [
      'extra generated encoding attributes',
      (xml: string) =>
        xml.replace(
          "<color column='[Sales].[none:Segment:nk]' />",
          "<color column='[Sales].[none:Segment:nk]' type='palette' />",
        ),
    ],
  ])('rejects %s drift even when intended and both readbacks agree', (_label, mutate) => {
    const input = structureInputForSource(sourceWorksheetWithPreservedContent());
    const changed = mutate(input.intendedWorksheetXml);
    expect(changed).not.toBe(input.intendedWorksheetXml);
    input.intendedWorksheetXml = changed;
    input.readbackWorksheetXml = changed;
    input.readbackWorkbookXml = workbook(changed, helperDefinitions(changed));

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('worksheet-content');
  });

  it('allows only direct window focus attributes to change', () => {
    const input = structureInput();
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      "<window class='worksheet' name='Orders'>",
      "<window active='true' class='worksheet' maximized='true' name='Orders'>",
    );

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });

    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      "<active id='-1' />",
      "<active id='0' />",
    );
    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('accepts the one exact host-added accessibility manifest marker when alt text was added', () => {
    const input = structureInput();
    expect(input.sourceWorksheetXml).not.toContain('<alt-text>');
    expect(input.intendedWorksheetXml).toContain('<alt-text>');
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '<document-format-change-manifest />',
      '<document-format-change-manifest><AccessibilityEditableAltText /></document-format-change-manifest>',
    );

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });
  });

  it('requires a source accessibility manifest marker to remain exact', () => {
    const input = structureInput();
    input.sourceWorkbookXml = input.sourceWorkbookXml.replace(
      '<document-format-change-manifest />',
      '<document-format-change-manifest><AccessibilityEditableAltText /></document-format-change-manifest>',
    );
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '<document-format-change-manifest />',
      '<document-format-change-manifest><AccessibilityEditableAltText /></document-format-change-manifest>',
    );
    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });

    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '<AccessibilityEditableAltText />',
      "<AccessibilityEditableAltText changed='true' />",
    );
    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it.each([
    ['duplicate markers', '<AccessibilityEditableAltText /><AccessibilityEditableAltText />'],
    ['marker attributes', "<AccessibilityEditableAltText enabled='true' />"],
    [
      'marker element children',
      '<AccessibilityEditableAltText><unexpected /></AccessibilityEditableAltText>',
    ],
    ['marker text', '<AccessibilityEditableAltText>enabled</AccessibilityEditableAltText>'],
    [
      'an unrelated manifest flag beside the marker',
      '<AccessibilityEditableAltText /><AccessibilityFutureFlag />',
    ],
  ])('rejects %s in the host accessibility manifest transition', (_label, markerXml) => {
    const input = structureInput();
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '<document-format-change-manifest />',
      `<document-format-change-manifest>${markerXml}</document-format-change-manifest>`,
    );

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('does not allow a new manifest marker when the source already supplied alt text', () => {
    const source = sourceWorksheet().replace(
      '<table>',
      '<layout-options><alt-text><formatted-text><run>Existing alt</run></formatted-text></alt-text></layout-options><table>',
    );
    const input = structureInputForSource(source);
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '<document-format-change-manifest />',
      '<document-format-change-manifest><AccessibilityEditableAltText /></document-format-change-manifest>',
    );

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it.each([
    ['a missing manifest container', ''],
    [
      'duplicate manifest containers',
      '<document-format-change-manifest><AccessibilityEditableAltText /></document-format-change-manifest><document-format-change-manifest />',
    ],
    [
      'a workbook-root marker',
      '<document-format-change-manifest /><AccessibilityEditableAltText />',
    ],
    [
      'a nested marker',
      '<document-format-change-manifest><wrapper><AccessibilityEditableAltText /></wrapper></document-format-change-manifest>',
    ],
  ])(
    'rejects %s instead of normalizing it as the live manifest transition',
    (_label, manifestXml) => {
      const input = structureInput();
      input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
        '<document-format-change-manifest />',
        manifestXml,
      );

      expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
    },
  );

  it.each([
    ['worksheet identity', (xml: string) => xml.replace(WORKSHEET_ID, '{OTHER}')],
    ['helper formula', (xml: string) => xml.replace("formula='INDEX()'", "formula='INDEX()+1'")],
    [
      'filter',
      (xml: string) => xml.replace("member='&quot;West&quot;'", "member='&quot;East&quot;'"),
    ],
    [
      'generated shelf',
      (xml: string) => xml.replace('</cols>', ' / [Sales].[none:Segment:nk]</cols>'),
    ],
    [
      'axis',
      (xml: string) =>
        xml.replace(
          `field='[Sales].[usr:${PREFIX}y:qk]' scope='rows'`,
          "field='[Sales].[sum:Profit:qk]' scope='rows'",
        ),
    ],
  ])('rejects %s drift through the planner contract', (_label, mutate) => {
    const input = structureInput();
    const changed = mutate(input.readbackWorksheetXml);
    expect(changed).not.toBe(input.readbackWorksheetXml);
    input.readbackWorksheetXml = changed;
    input.readbackWorkbookXml = workbook(changed, helperDefinitions(changed));

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('worksheet-content');
  });

  it('requires exact top-level helper promotion and prevents helper leaks', () => {
    const visible = structureInput();
    visible.readbackWorkbookXml = workbook(
      visible.readbackWorksheetXml,
      helperDefinitions(visible.readbackWorksheetXml, false),
    );
    expect(findingCodes(verifyRoundStackedBarStructure(visible))).toContain('helper-visibility');

    const leaked = structureInput();
    leaked.readbackWorkbookXml = leaked.readbackWorkbookXml.replace(
      '</datasources>',
      `<datasource name='Other'><column hidden='true' name='[${PREFIX}leak]'><calculation class='tableau' formula='1' /></column></datasource></datasources>`,
    );
    expect(findingCodes(verifyRoundStackedBarStructure(leaked))).toContain('helper-definition');
  });

  it('rejects a stale source Bar embedded in the readback workbook', () => {
    const input = structureInput();
    input.readbackWorkbookXml = workbook(
      sourceWorksheet(),
      helperDefinitions(input.intendedWorksheetXml),
    );

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('rejects loss of unrelated content from the target top-level datasource', () => {
    const input = structureInput();
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      "<column name='[Existing]' />",
      '',
    );

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('accepts save/reopen reordering of direct table calculations in an unrelated column instance', () => {
    const input = structureInputWithUnrelatedTableCalcs([...UNRELATED_TABLE_CALCS].reverse());

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });
  });

  it('rejects reordering typed table calculations whose sibling order defines wrapper semantics', () => {
    const input = structureInputWithUnrelatedTableCalcs(
      [...ORDERED_TYPED_TABLE_CALCS].reverse(),
      ORDERED_TYPED_TABLE_CALCS,
    );

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it.each([
    ['deletion', [UNRELATED_TABLE_CALCS[0]]],
    [
      'attribute value mutation',
      [
        UNRELATED_TABLE_CALCS[0].replace("ordering-type='Field'", "ordering-type='Manual'"),
        UNRELATED_TABLE_CALCS[1],
      ],
    ],
    ['duplication', [UNRELATED_TABLE_CALCS[0], UNRELATED_TABLE_CALCS[1], UNRELATED_TABLE_CALCS[1]]],
  ])('rejects unrelated direct table-calculation %s', (_label, readbackTableCalcs) => {
    const input = structureInputWithUnrelatedTableCalcs(readbackTableCalcs);

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it.each([
    ['another worksheet', "attr='display-tabs' value='true'", "attr='display-tabs' value='false'"],
    ['dashboard zone geometry', "h='200' id='4'", "h='201' id='4'"],
    ['window content', '<strip />', "<strip mode='compact' />"],
    ['other top-level content', "name='show-tabs' value='true'", "name='show-tabs' value='false'"],
    ['non-whitespace text', '>Other worksheet<', '> Other worksheet <'],
  ])('rejects collateral changes to %s', (_label, before, after) => {
    const input = structureInput();
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(before, after);

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('fails closed before normalization can hide duplicate target owners', () => {
    const input = structureInput();
    const duplicateSheet = input.sourceWorksheetXml.replace("name='Orders'", "name='Orders Copy'");
    input.sourceWorkbookXml = input.sourceWorkbookXml.replace(
      '</worksheets>',
      `${duplicateSheet}</worksheets>`,
    );
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '</worksheets>',
      `${input.readbackWorksheetXml.replace("name='Orders'", "name='Orders Copy'")}</worksheets>`,
    );
    input.sourceWorkbookXml = input.sourceWorkbookXml.replace(
      '</datasources>',
      "<datasource caption='Duplicate' name='Sales' /></datasources>",
    );
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '</datasources>',
      "<datasource caption='Duplicate' name='Sales' /></datasources>",
    );

    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('workbook-identity');
  });

  it('resolves the embedded readback target by stable id rather than display name', () => {
    const input = structureInput();
    const decoy = "<worksheet name='Orders'><simple-id uuid='{DECOY}' /></worksheet>";
    input.sourceWorkbookXml = input.sourceWorkbookXml.replace(
      '<worksheets>',
      `<worksheets>${decoy}`,
    );
    input.readbackWorkbookXml = input.readbackWorkbookXml.replace(
      '<worksheets>',
      `<worksheets>${decoy}`,
    );

    expect(verifyRoundStackedBarStructure(input)).toEqual({ ok: true, findings: [] });
  });

  it('fails closed when the readback target worksheet or datasource is missing', () => {
    const missingWorksheet = structureInput();
    missingWorksheet.readbackWorkbookXml = missingWorksheet.readbackWorkbookXml.replace(
      missingWorksheet.readbackWorksheetXml,
      '',
    );
    expect(findingCodes(verifyRoundStackedBarStructure(missingWorksheet))).toContain(
      'workbook-identity',
    );

    const missingDatasource = structureInput();
    const targetDatasource = missingDatasource.readbackWorkbookXml.match(
      /<datasource caption='Friendly Sales' name='Sales'>[\s\S]*?<\/datasource>/,
    )?.[0];
    expect(targetDatasource).toBeTruthy();
    missingDatasource.readbackWorkbookXml = missingDatasource.readbackWorkbookXml.replace(
      targetDatasource ?? '',
      '',
    );
    expect(findingCodes(verifyRoundStackedBarStructure(missingDatasource))).toContain(
      'workbook-identity',
    );
  });

  it.each(['sourceWorksheetXml', 'intendedWorksheetXml', 'readbackWorksheetXml'] as const)(
    'fails closed on malformed %s',
    (key) => {
      const input = structureInput();
      input[key] = '<worksheet><table>';
      expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('xml-parse');
    },
  );

  it('fails closed on malformed source-workbook XML', () => {
    const input = structureInput();
    input.sourceWorkbookXml = '<workbook><worksheets>';
    expect(findingCodes(verifyRoundStackedBarStructure(input))).toContain('xml-parse');
  });
});
