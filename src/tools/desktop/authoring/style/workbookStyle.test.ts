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

function directElements(parent: XmlNode, name: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      const element = child as unknown as XmlElement;
      if (element.nodeName === name && !element.namespaceURI) matches.push(element);
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
      (_, index) => `<dashboard name="Dashboard ${index}"><style/></dashboard>`,
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
