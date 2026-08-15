import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOMParser, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';

import type { EligibleStyleArtifact } from './eligibleArtifacts.js';
import type { TableauStylePackV2 } from './stylePack.js';
import { applyWorkbookStyle } from './workbookStyle.js';

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

const eligibleArtifacts: EligibleStyleArtifact[] = [
  { kind: 'worksheet', id: 'visible-id', name: 'Visible', hidden: false },
  { kind: 'worksheet', id: 'hidden-used-id', name: 'Hidden Used', hidden: true },
  { kind: 'dashboard', id: 'dashboard-id', name: 'Overview', hidden: false },
];

const styledWorksheet = (name: string): string => `<worksheet name="${name}">
  <layout-options><title><formatted-text><run fontname="Old Title" fontcolor="#010101" fontsize="12">${name}</run></formatted-text></title></layout-options>
  <table><style>
    <style-rule element="all"><format attr="font-family" value="Old Body"/><format attr="color" value="#020202"/></style-rule>
    <style-rule element="table"><format attr="background-color" value="#030303"/></style-rule>
    <style-rule element="mark">
      <encoding attr="color" field="[Category]" type="palette"><map marker="first" to="#111111"><bucket>&quot;A&quot;</bucket></map><map marker="second" to="#222222"><bucket>&quot;B&quot;</bucket></map></encoding>
      <encoding attr="color" field="[Sales]" type="custom-interpolated"><color-palette custom="true" type="ordered-sequential"><color>#eeeeee</color><color>#111111</color></color-palette></encoding>
      <encoding attr="color" field="[Profit]" type="custom-interpolated"><color-palette custom="true" type="ordered-diverging"><color>#aa0000</color><color>#ffffff</color><color>#00aa00</color></color-palette></encoding>
    </style-rule>
  </style></table>
</worksheet>`;

const workbookXml = `<workbook xmlns:ext="urn:test"><worksheets>${styledWorksheet('Visible')}${styledWorksheet('Hidden Used')}${styledWorksheet('Hidden Orphan')}</worksheets><dashboards><dashboard name="Overview"><zones><zone name="Visible"/></zones></dashboard></dashboards></workbook>`;

function directElements(parent: XmlNode, name?: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      const element = child as unknown as XmlElement;
      if (name === undefined || (element.nodeName === name && !element.namespaceURI)) {
        matches.push(element);
      }
    }
  }
  return matches;
}

function worksheet(xml: string, name: string): XmlElement {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  if (!root) throw new Error('Missing workbook root');
  const worksheets = directElements(root, 'worksheets')[0];
  if (!worksheets) throw new Error('Missing worksheets collection');
  const match = directElements(worksheets, 'worksheet').find(
    (element) => element.getAttribute('name') === name,
  );
  if (!match) throw new Error(`Missing worksheet ${name}`);
  return match;
}

function dashboard(xml: string, name: string): XmlElement {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  if (!root) throw new Error('Missing workbook root');
  const dashboards = directElements(root, 'dashboards')[0];
  if (!dashboards) throw new Error('Missing dashboards collection');
  const match = directElements(dashboards, 'dashboard').find(
    (element) => element.getAttribute('name') === name,
  );
  if (!match) throw new Error(`Missing dashboard ${name}`);
  return match;
}

describe('applyWorkbookStyle', () => {
  it('updates every supported existing style value only inside eligible worksheets', () => {
    const result = applyWorkbookStyle(workbookXml, stylePack, eligibleArtifacts);

    expect(result.changedEligibleIds).toEqual(['visible-id', 'hidden-used-id']);
    expect(result.unchangedEligibleIds).toEqual(['dashboard-id']);
    for (const name of ['Visible', 'Hidden Used']) {
      const transformed = worksheet(result.workbookXml, name);
      expect(transformed.getElementsByTagName('run')[0].getAttribute('fontname')).toBe(
        'Tableau Semibold',
      );
      expect(transformed.getElementsByTagName('run')[0].getAttribute('fontcolor')).toBe('#171321');
      expect(
        Array.from(transformed.getElementsByTagName('format')).map((format) =>
          format.getAttribute('value'),
        ),
      ).toEqual(['Tableau Regular', '#171321', '#FFFFFF']);
      expect(
        Array.from(transformed.getElementsByTagName('map')).map((map) => map.getAttribute('to')),
      ).toEqual(['#7759C2', '#FC6D26']);
      expect(
        Array.from(transformed.getElementsByTagName('color')).map((color) => color.textContent),
      ).toEqual(['#F1ECFF', '#7759C2', '#D63939', '#FFFFFF', '#108548']);
    }
    expect(worksheet(result.workbookXml, 'Hidden Orphan').toString()).toContain('Old Title');
  });

  it('inserts one canonical title before the sole table only for an eligible generated worksheet', () => {
    const generatedXml = `<workbook xmlns:ext="urn:test"><worksheets>
      <worksheet name="Sales &amp; Profit"><repository-location derived-from="template"/><ext:before/><table><view/></table><ext:after/></worksheet>
      <worksheet name="Existing"><layout-options><title><formatted-text><run fontcolor="#old" fontname="Old Font">Existing</run></formatted-text></title></layout-options><table/></worksheet>
      <worksheet name="Incomplete"><layout-options><title/></layout-options><table/></worksheet>
      <worksheet name="Ambiguous"><table/><table/></worksheet>
      <worksheet name="Missing Table"><style/></worksheet>
      <worksheet name="Namespace Collision"><ext:layout-options/><table/></worksheet>
      <worksheet name="Namespaced Table"><ext:table/></worksheet>
      <worksheet name=" "><table/></worksheet>
      <worksheet name="Ineligible"><table/></worksheet>
    </worksheets><dashboards/></workbook>`;
    const artifacts: EligibleStyleArtifact[] = [
      { kind: 'worksheet', id: 'generated-id', name: 'Sales & Profit', hidden: false },
      { kind: 'worksheet', id: 'existing-id', name: 'Existing', hidden: false },
      { kind: 'worksheet', id: 'incomplete-id', name: 'Incomplete', hidden: false },
      { kind: 'worksheet', id: 'ambiguous-id', name: 'Ambiguous', hidden: false },
      { kind: 'worksheet', id: 'missing-id', name: 'Missing Table', hidden: false },
      {
        kind: 'worksheet',
        id: 'namespace-collision-id',
        name: 'Namespace Collision',
        hidden: false,
      },
      { kind: 'worksheet', id: 'namespaced-table-id', name: 'Namespaced Table', hidden: false },
      { kind: 'worksheet', id: 'blank-id', name: ' ', hidden: false },
    ];

    const first = applyWorkbookStyle(generatedXml, stylePack, artifacts);
    const generated = worksheet(first.workbookXml, 'Sales & Profit').toString();

    expect(first.changedEligibleIds).toEqual(['generated-id', 'existing-id']);
    expect(first.unchangedEligibleIds).toEqual([
      'incomplete-id',
      'ambiguous-id',
      'missing-id',
      'namespace-collision-id',
      'namespaced-table-id',
      'blank-id',
    ]);
    expect(generated).toContain(
      '<layout-options><title><formatted-text><run fontcolor="#171321" fontname="Tableau Semibold">&lt;Sheet Name&gt;</run></formatted-text></title></layout-options><table>',
    );
    expect(generated).not.toContain('>Sales &amp; Profit</run>');
    expect(
      directElements(worksheet(first.workbookXml, 'Sales & Profit'), 'layout-options'),
    ).toHaveLength(1);
    expect(generated.indexOf('<ext:before/>')).toBeLessThan(generated.indexOf('<layout-options>'));
    expect(
      directElements(worksheet(first.workbookXml, 'Sales & Profit')).map(
        (element) => element.nodeName,
      ),
    ).toEqual(['repository-location', 'ext:before', 'layout-options', 'table', 'ext:after']);
    expect(directElements(worksheet(first.workbookXml, 'Existing'), 'layout-options')).toHaveLength(
      1,
    );
    expect(worksheet(first.workbookXml, 'Existing').toString()).toContain(
      '<run fontcolor="#171321" fontname="Tableau Semibold">Existing</run>',
    );
    for (const name of [
      'Incomplete',
      'Ambiguous',
      'Missing Table',
      'Namespace Collision',
      'Namespaced Table',
      ' ',
    ]) {
      expect(worksheet(first.workbookXml, name).toString()).toBe(
        worksheet(generatedXml, name).toString(),
      );
    }
    expect(worksheet(first.workbookXml, 'Ineligible').toString()).toBe(
      worksheet(generatedXml, 'Ineligible').toString(),
    );

    const second = applyWorkbookStyle(first.workbookXml, stylePack, artifacts);
    expect(second.workbookXml).toBe(first.workbookXml);
    expect(second.changedEligibleIds).toEqual([]);
    expect(second.unchangedEligibleIds).toEqual(artifacts.map(({ id }) => id));

    const renamedXml = first.workbookXml.replace(
      'name="Sales &amp; Profit"',
      'name="Renamed Sheet"',
    );
    const renamed = applyWorkbookStyle(renamedXml, stylePack, [
      { kind: 'worksheet', id: 'generated-id', name: 'Renamed Sheet', hidden: false },
    ]);
    expect(renamed.changedEligibleIds).toEqual([]);
    expect(worksheet(renamed.workbookXml, 'Renamed Sheet').toString()).toContain(
      '<run fontcolor="#171321" fontname="Tableau Semibold">&lt;Sheet Name&gt;</run>',
    );
    expect(worksheet(renamed.workbookXml, 'Renamed Sheet').toString()).not.toContain(
      '>Sales &amp; Profit</run>',
    );
  });

  it('styles only the live-shaped eligible dashboard title text zone without inventing run attributes', () => {
    const liveDashboardXml = `<workbook xmlns:ext="urn:test"><worksheets/><dashboards>
      <dashboard name="Sales and Profit Overview"><style/><zones><zone h="100000" id="9" type-v2="layout-basic" w="100000" x="0" y="0">
        <zone h="8000" id="10" type-v2="text" w="100000" x="0" y="0"><formatted-text><run bold="true" fontcolor="#1f77b4" fontname="Tableau Light" fontsize="16">Sales and </run><run ext:fontcolor="#keep" fontname="Tableau Light">Profit Overview</run></formatted-text></zone>
        <zone h="8000" id="11" type-v2="text" w="100000" x="0" y="8000"><formatted-text><run fontcolor="#1f77b4" fontname="Tableau Light">Read the footnote</run></formatted-text></zone>
      </zone></zones></dashboard>
      <dashboard name="Plain"><style/></dashboard>
      <dashboard name="Ineligible"><zones><zone type-v2="layout-basic"><zone type-v2="text"><formatted-text><run fontcolor="#1f77b4" fontname="Tableau Light">Ineligible</run></formatted-text></zone></zone></zones></dashboard>
    </dashboards></workbook>`;
    const eligibleDashboards: EligibleStyleArtifact[] = [
      {
        kind: 'dashboard',
        id: 'sales-dashboard-id',
        name: 'Sales and Profit Overview',
        hidden: false,
      },
      { kind: 'dashboard', id: 'plain-dashboard-id', name: 'Plain', hidden: false },
    ];

    const first = applyWorkbookStyle(liveDashboardXml, stylePack, eligibleDashboards);
    const transformed = dashboard(first.workbookXml, 'Sales and Profit Overview');
    const runs = Array.from(transformed.getElementsByTagName('run'));

    expect(first.changedEligibleIds).toEqual(['sales-dashboard-id']);
    expect(first.unchangedEligibleIds).toEqual(['plain-dashboard-id']);
    expect(runs[0].getAttribute('fontname')).toBe('Tableau Semibold');
    expect(runs[0].getAttribute('fontcolor')).toBe('#171321');
    expect(runs[1].getAttribute('fontname')).toBe('Tableau Semibold');
    expect(runs[1].hasAttribute('fontcolor')).toBe(false);
    expect(runs[1].getAttribute('ext:fontcolor')).toBe('#keep');
    expect(runs[2].getAttribute('fontname')).toBe('Tableau Light');
    expect(runs[2].getAttribute('fontcolor')).toBe('#1f77b4');
    expect(dashboard(first.workbookXml, 'Ineligible').toString()).toContain(
      'fontname="Tableau Light"',
    );

    const second = applyWorkbookStyle(first.workbookXml, stylePack, eligibleDashboards);
    expect(second.workbookXml).toBe(first.workbookXml);
    expect(second.changedEligibleIds).toEqual([]);
    expect(second.unchangedEligibleIds).toEqual(['sales-dashboard-id', 'plain-dashboard-id']);
  });

  it('reports only meaningful existing dashboard style content as unsupported', () => {
    const xml =
      '<workbook><worksheets/><dashboards>' +
      '<dashboard name="Empty"><style/></dashboard>' +
      '<dashboard name="Meaningful"><style><style-rule element="dashboard"/></style></dashboard>' +
      '</dashboards></workbook>';
    const artifacts: EligibleStyleArtifact[] = [
      { kind: 'dashboard', id: 'empty-id', name: 'Empty', hidden: false },
      { kind: 'dashboard', id: 'meaningful-id', name: 'Meaningful', hidden: false },
    ];

    const result = applyWorkbookStyle(xml, stylePack, artifacts);

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'dashboard-style-unsupported',
        eligibleArtifactIds: ['meaningful-id'],
        affectedArtifactCount: 1,
      }),
    );
  });

  it('updates shared categorical colors one-to-one without changing map buckets, attributes, or order', () => {
    const sharedColorXml = workbookXml.replace(
      '<map marker="second" to="#222222"><bucket>&quot;B&quot;</bucket></map>',
      '<map marker="second" to="#111111"><bucket>&quot;B&quot;</bucket></map><map marker="third" to="#222222"><bucket>&quot;C&quot;</bucket></map>',
    );

    const result = applyWorkbookStyle(sharedColorXml, stylePack, eligibleArtifacts);
    const maps = Array.from(worksheet(result.workbookXml, 'Visible').getElementsByTagName('map'));

    expect(maps.map((map) => [map.getAttribute('marker'), map.getAttribute('to')])).toEqual([
      ['first', '#7759C2'],
      ['second', '#7759C2'],
      ['third', '#FC6D26'],
    ]);
    expect(maps.map((map) => map.textContent)).toEqual(['"A"', '"B"', '"C"']);
  });

  it('is byte-idempotent after serialization and reports changed ids honestly', () => {
    const first = applyWorkbookStyle(workbookXml, stylePack, eligibleArtifacts);
    const second = applyWorkbookStyle(first.workbookXml, stylePack, eligibleArtifacts);

    expect(second.workbookXml).toBe(first.workbookXml);
    expect(second.changedEligibleIds).toEqual([]);
    expect(second.unchangedEligibleIds).toEqual(['visible-id', 'hidden-used-id', 'dashboard-id']);
  });

  it('updates existing values for a changed pack without adding duplicate style nodes', () => {
    const first = applyWorkbookStyle(workbookXml, stylePack, eligibleArtifacts);
    const changedPack: TableauStylePackV2 = {
      ...stylePack,
      typography: { titleFont: 'Tableau Bold', bodyFont: 'Tableau Light' },
      palette: {
        ...stylePack.palette,
        categorical: ['#111111', '#222222'],
        sequential: ['#333333', '#444444'],
        diverging: { negative: '#555555', midpoint: '#666666', positive: '#777777' },
        text: '#888888',
        background: '#999999',
      },
    };

    const second = applyWorkbookStyle(first.workbookXml, changedPack, eligibleArtifacts);
    const transformed = worksheet(second.workbookXml, 'Visible');

    expect(second.changedEligibleIds).toEqual(['visible-id', 'hidden-used-id']);
    expect(transformed.getElementsByTagName('run')).toHaveLength(1);
    expect(transformed.getElementsByTagName('format')).toHaveLength(3);
    expect(transformed.getElementsByTagName('map')).toHaveLength(2);
    expect(transformed.getElementsByTagName('color')).toHaveLength(5);
    expect(transformed.getElementsByTagName('run')[0].getAttribute('fontname')).toBe(
      'Tableau Bold',
    );
    expect(
      Array.from(transformed.getElementsByTagName('format')).map((format) =>
        format.getAttribute('value'),
      ),
    ).toEqual(['Tableau Light', '#888888', '#999999']);
  });

  it('fails closed before mutation when an eligible target is missing or ambiguous', () => {
    expect(() =>
      applyWorkbookStyle(workbookXml, stylePack, [
        ...eligibleArtifacts,
        { kind: 'worksheet', id: 'missing-id', name: 'Missing', hidden: false },
      ]),
    ).toThrow('worksheet "Missing" (missing-id) is missing from workbook XML');

    const ambiguous = workbookXml.replace(
      '</worksheets>',
      `${styledWorksheet('Visible')}</worksheets>`,
    );
    expect(() => applyWorkbookStyle(ambiguous, stylePack, eligibleArtifacts)).toThrow(
      'worksheet "Visible" (visible-id) matches 2 workbook XML elements',
    );
  });

  it('rejects malformed XML, parser warning recovery, and a namespaced workbook root', () => {
    expect(() => applyWorkbookStyle('<workbook><worksheets></workbook>', stylePack, [])).toThrow(
      'Cannot apply workbook style to malformed workbook XML',
    );
    expect(() => applyWorkbookStyle('<workbook recovered=yes/>', stylePack, [])).toThrow(
      'Cannot apply workbook style to malformed workbook XML',
    );
    expect(() => applyWorkbookStyle('<ext:workbook xmlns:ext="urn:test"/>', stylePack, [])).toThrow(
      'Workbook styling requires a <workbook> XML document',
    );
  });

  it('does not treat namespaced path or attribute collisions as supported style nodes', () => {
    const collisionXml =
      '<workbook xmlns:ext="urn:test"><worksheets><worksheet name="Visible"><ext:layout-options><ext:title><ext:formatted-text><ext:run fontname="Wrong">Wrong</ext:run></ext:formatted-text></ext:title></ext:layout-options><layout-options><title><formatted-text><run ext:fontname="Namespaced" ext:fontcolor="#010101">Visible</run></formatted-text></title></layout-options><table><style><style-rule element="mark"><ext:encoding attr="color" type="palette"><ext:map to="#111111"/></ext:encoding></style-rule></style></table></worksheet></worksheets><dashboards/></workbook>';
    const onlyVisible = [eligibleArtifacts[0]];

    const result = applyWorkbookStyle(collisionXml, stylePack, onlyVisible);

    expect(result.changedEligibleIds).toEqual([]);
    expect(result.unchangedEligibleIds).toEqual(['visible-id']);
    expect(result.workbookXml).toContain('ext:fontname="Namespaced"');
    expect(result.workbookXml).toContain('<ext:map to="#111111"/>');
    expect(result.workbookXml).not.toContain('Tableau Semibold');
  });

  it('preserves unknown nodes, unknown attributes, mixed content, and sibling order', () => {
    const adversarialXml =
      '<workbook xmlns:ext="urn:test"><worksheets><worksheet name="Visible"><layout-options><title><formatted-text><run fontname="Old" fontcolor="#000000" ext:semantic="keep">A<ext:token/>B</run></formatted-text></title></layout-options><table><style><ext:before/><style-rule element="mark" ext:selector="keep"><encoding attr="color" field="[Sales]" type="custom-interpolated" ext:encoding="keep"><color-palette custom="true" type="ordered-sequential" ext:palette="keep"><color>#old<ext:semantic/>tail</color><color>#second</color></color-palette></encoding></style-rule><ext:after/></style></table></worksheet></worksheets><dashboards/></workbook>';

    const result = applyWorkbookStyle(adversarialXml, stylePack, [eligibleArtifacts[0]]);

    expect(result.workbookXml).toContain('ext:semantic="keep"');
    expect(result.workbookXml).toContain('A<ext:token/>B');
    expect(result.workbookXml).toContain('<color>#old<ext:semantic/>tail</color>');
    expect(result.workbookXml).toContain('<color>#second</color>');
    expect(result.workbookXml.indexOf('<ext:before/>')).toBeLessThan(
      result.workbookXml.indexOf('<ext:after/>'),
    );
  });

  it.each([
    [
      'unknown encoding type',
      'type="custom-interpolated"><color-palette custom="true" type="ordered-sequential"',
      'type="semantic-unknown"><color-palette custom="true" type="ordered-sequential"',
    ],
    [
      'missing custom marker',
      '<color-palette custom="true" type="ordered-sequential">',
      '<color-palette type="ordered-sequential">',
    ],
    [
      'false custom marker',
      '<color-palette custom="true" type="ordered-sequential">',
      '<color-palette custom="false" type="ordered-sequential">',
    ],
  ])('does not recolor an interpolated palette with %s', (_label, before, after) => {
    const unsupported = workbookXml.replace(before, after);

    const result = applyWorkbookStyle(unsupported, stylePack, eligibleArtifacts);
    const colors = Array.from(
      worksheet(result.workbookXml, 'Visible').getElementsByTagName('color'),
    );

    expect(colors.slice(0, 2).map((color) => color.textContent)).toEqual(['#eeeeee', '#111111']);
  });

  it('emits explicit findings and makes no palette mutation when arity does not match', () => {
    const mismatchPack: TableauStylePackV2 = {
      ...stylePack,
      palette: {
        ...stylePack.palette,
        categorical: ['#111111', '#222222', '#333333'],
        sequential: ['#111111', '#222222', '#333333'],
      },
    };

    const result = applyWorkbookStyle(workbookXml, mismatchPack, eligibleArtifacts);

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'categorical-palette-arity-mismatch',
        eligibleArtifactIds: expect.arrayContaining(['visible-id']),
        affectedArtifactCount: 2,
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'sequential-palette-arity-mismatch',
        eligibleArtifactIds: expect.arrayContaining(['visible-id']),
        affectedArtifactCount: 2,
      }),
    );
    expect(
      Array.from(worksheet(result.workbookXml, 'Visible').getElementsByTagName('map')).map((map) =>
        map.getAttribute('to'),
      ),
    ).toEqual(['#111111', '#222222']);
    expect(
      Array.from(worksheet(result.workbookXml, 'Visible').getElementsByTagName('color'))
        .slice(0, 2)
        .map((color) => color.textContent),
    ).toEqual(['#eeeeee', '#111111']);
  });

  it('reports unsupported pack rules, advisory rules, dashboard styling, and global datasource styles', () => {
    const unsupportedXml = workbookXml
      .replace(
        '<workbook xmlns:ext="urn:test">',
        '<workbook xmlns:ext="urn:test"><datasources><datasource name="ds"><style><format attr="font-family" value="Old"/></style></datasource></datasources>',
      )
      .replace(
        '<dashboard name="Overview">',
        '<dashboard name="Overview"><style><style-rule element="dashboard"/></style>',
      );

    const result = applyWorkbookStyle(unsupportedXml, stylePack, eligibleArtifacts);
    const codes = result.findings.map(({ code }) => code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'brand-primary-unsupported',
        'currency-format-unsupported',
        'date-format-unsupported',
        'time-format-unsupported',
        'fiscal-quarter-format-unsupported',
        'fiscal-year-format-unsupported',
        'fiscal-year-quarter-format-unsupported',
        'dashboard-outer-padding-unsupported',
        'dashboard-inner-spacing-unsupported',
        'dashboard-title-alignment-unsupported',
        'dashboard-style-unsupported',
        'global-datasource-style-unsupported',
        'avoid-pie-charts-advisory',
        'label-calculated-data-advisory',
      ]),
    );
    expect(result.findings.length).toBeLessThanOrEqual(32);
    const userFacingFindings = result.findings.map(({ message }) => message).join('\n');
    expect(userFacingFindings).not.toMatch(/\bv1\b/i);
    expect(userFacingFindings).not.toMatch(
      /(?:pack|schema|tableau build|style engine).*(?:incompatib|unsupported|not supported)/i,
    );
    for (const finding of result.findings.filter(({ code }) => code.endsWith('-unsupported'))) {
      expect(finding.message).toContain('not yet automated by apply-workbook-style');
      expect(finding.message).toMatch(/no workbook XML was invented|workbook XML was preserved/);
    }
    expect(result.workbookXml).toContain('<datasource name="ds"><style>');
    expect(result.workbookXml).toContain('<dashboard name="Overview"><style>');
  });

  it('serializes the current live readback fixture byte-identically on a second apply', () => {
    const liveXml = readFileSync(
      join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
      'utf8',
    );
    const liveEligible: EligibleStyleArtifact[] = [
      { kind: 'worksheet', id: 'live-sheet-id', name: 'se-eval-scratch', hidden: false },
    ];

    const first = applyWorkbookStyle(liveXml, stylePack, liveEligible);
    const second = applyWorkbookStyle(first.workbookXml, stylePack, liveEligible);

    expect(second.workbookXml).toBe(first.workbookXml);
    expect(second.changedEligibleIds).toEqual([]);
    expect(second.unchangedEligibleIds).toEqual(['live-sheet-id']);
  });

  it('keeps a worksheet arity finding ahead of 25 styled-dashboard summaries', () => {
    const dashboards = Array.from(
      { length: 25 },
      (_, index) =>
        `<dashboard name="Dashboard ${index}"><style><style-rule element="dashboard"/></style></dashboard>`,
    ).join('');
    const xml = `<workbook><worksheets>${styledWorksheet('Mismatch')}</worksheets><dashboards>${dashboards}</dashboards></workbook>`;
    const artifacts: EligibleStyleArtifact[] = [
      { kind: 'worksheet', id: 'mismatch-id', name: 'Mismatch', hidden: false },
      ...Array.from(
        { length: 25 },
        (_, index): EligibleStyleArtifact => ({
          kind: 'dashboard',
          id: `dashboard-${index}`,
          name: `Dashboard ${index}`,
          hidden: false,
        }),
      ),
    ];
    const mismatchPack: TableauStylePackV2 = {
      ...stylePack,
      palette: { ...stylePack.palette, categorical: ['#111111', '#222222', '#333333'] },
    };

    const result = applyWorkbookStyle(xml, mismatchPack, artifacts);

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'categorical-palette-arity-mismatch',
        eligibleArtifactIds: ['mismatch-id'],
        affectedArtifactCount: 1,
      }),
    );
    expect(
      result.findings.filter(({ code }) => code === 'dashboard-style-unsupported'),
    ).toHaveLength(1);
    expect(result.findings.length).toBeLessThanOrEqual(32);
  });

  it('groups more than 32 palette mismatches without hiding a skipped rule or growing output', () => {
    const worksheetCount = 40;
    const worksheets = Array.from({ length: worksheetCount }, (_, index) =>
      styledWorksheet(`Mismatch ${index}`),
    ).join('');
    const artifacts: EligibleStyleArtifact[] = Array.from(
      { length: worksheetCount },
      (_, index) => ({
        kind: 'worksheet',
        id: `mismatch-${index}`,
        name: `Mismatch ${index}`,
        hidden: false,
      }),
    );
    const mismatchPack: TableauStylePackV2 = {
      ...stylePack,
      palette: {
        ...stylePack.palette,
        categorical: ['#111111', '#222222', '#333333'],
        sequential: ['#111111', '#222222', '#333333'],
      },
    };

    const result = applyWorkbookStyle(
      `<workbook><worksheets>${worksheets}</worksheets><dashboards/></workbook>`,
      mismatchPack,
      artifacts,
    );

    for (const code of [
      'categorical-palette-arity-mismatch',
      'sequential-palette-arity-mismatch',
    ]) {
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          code,
          affectedArtifactCount: worksheetCount,
          eligibleArtifactIds: [
            'mismatch-0',
            'mismatch-1',
            'mismatch-2',
            'mismatch-3',
            'mismatch-4',
            'mismatch-5',
            'mismatch-6',
            'mismatch-7',
          ],
          omittedEligibleArtifactCount: 32,
        }),
      );
    }
    expect(result.findings.length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(result.findings).length).toBeLessThan(10_000);
  });
});
