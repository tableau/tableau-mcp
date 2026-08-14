import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import {
  analyticalFingerprint,
  eligibleStyleScopeFingerprint,
  workbookStyleStateFingerprint,
} from './analyticalFingerprint.js';
import type { EligibleStyleArtifact } from './eligibleArtifacts.js';

const baseXml = `<?xml version="1.0"?>
<workbook xmlns:ext="urn:tableau:test">
  <datasources>
    <datasource caption="Orders" name="orders">
      <connection class="textscan" filename="orders.csv"/>
      <column caption="Profit Ratio" datatype="real" name="[Calculation_1]" role="measure" type="quantitative">
        <calculation class="tableau" formula="SUM([Profit])/SUM([Sales])"/>
      </column>
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="Sales">
      <table>
        <view><filter column="[orders].[none:Region:nk]"/><ext:semantic mode="strict">keep me</ext:semantic></view>
        <style><style-rule element="all"><format attr="color" value="#111111"/></style-rule></style>
        <panes><pane><encodings><color column="[orders].[sum:Sales:qk]"/></encodings><mark class="Bar"/></pane></panes>
        <rows>[orders].[sum:Sales:qk]</rows><cols>[orders].[none:Category:nk]</cols>
      </table>
    </worksheet>
    <worksheet name="Profit"><table><rows>[orders].[sum:Profit:qk]</rows></table></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Overview"><zones><zone id="1" name="Sales" x="0" y="0" w="50000" h="50000"/></zones></dashboard>
  </dashboards>
</workbook>`;

describe('analyticalFingerprint', () => {
  it('accepts only XML text so every input passes strict malformed-XML detection', () => {
    expectTypeOf(analyticalFingerprint).parameter(0).toEqualTypeOf<string>();
  });

  it('is stable across formatting, attribute order, and DOM serializer normalization', () => {
    const reordered = baseXml
      .replace(
        '<connection class="textscan" filename="orders.csv"/>',
        '<connection filename="orders.csv" class="textscan"></connection>',
      )
      .replace(
        '<filter column="[orders].[none:Region:nk]"/>',
        '<filter   column="[orders].[none:Region:nk]"></filter>',
      );
    const serialized = new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(reordered, 'text/xml'),
    );

    expect(analyticalFingerprint(baseXml)).toBe(analyticalFingerprint(serialized));
  });

  it('keeps unsupported dashboard style and geometry changes analytical', () => {
    const restyled = baseXml
      .replace('#111111', '#ff0000')
      .replace(
        '<dashboard name="Overview">',
        '<dashboard name="Overview"><style><style-rule element="dashboard"><format attr="background" value="#ffffff"/></style-rule></style>',
      )
      .replace('x="0" y="0" w="50000" h="50000"', 'x="500" y="1000" w="49000" h="48000"');

    expect(analyticalFingerprint(restyled)).not.toBe(analyticalFingerprint(baseXml));
  });

  it.each([
    ['datasource definition', 'filename="orders.csv"', 'filename="other.csv"'],
    ['calculation', 'SUM([Profit])/SUM([Sales])', 'AVG([Profit])/SUM([Sales])'],
    ['filter', '[orders].[none:Region:nk]', '[orders].[none:Segment:nk]'],
    ['shelf', '[orders].[sum:Sales:qk]</rows>', '[orders].[avg:Sales:qk]</rows>'],
    [
      'encoding',
      '<color column="[orders].[sum:Sales:qk]"/>',
      '<size column="[orders].[sum:Sales:qk]"/>',
    ],
    ['mark', '<mark class="Bar"/>', '<mark class="Line"/>'],
    ['worksheet membership', '<worksheet name="Profit">', '<worksheet name="Margin">'],
    ['dashboard contained-sheet reference', 'name="Sales" x="0"', 'name="Profit" x="0"'],
  ])('changes when %s changes', (_label, before, after) => {
    expect(analyticalFingerprint(baseXml.replace(before, after))).not.toBe(
      analyticalFingerprint(baseXml),
    );
  });

  it('preserves unknown namespaced content and sibling order as analytical by default', () => {
    const changedUnknown = baseXml.replace('mode="strict"', 'mode="lenient"');
    const reorderedUnknown = baseXml.replace(
      '<filter column="[orders].[none:Region:nk]"/><ext:semantic mode="strict">keep me</ext:semantic>',
      '<ext:semantic mode="strict">keep me</ext:semantic><filter column="[orders].[none:Region:nk]"/>',
    );

    expect(analyticalFingerprint(changedUnknown)).not.toBe(analyticalFingerprint(baseXml));
    expect(analyticalFingerprint(reorderedUnknown)).not.toBe(analyticalFingerprint(baseXml));
  });

  it('does not broadly ignore format nodes with analytical attributes', () => {
    const analyticalFormat = baseXml.replace(
      '<format attr="color" value="#111111"/>',
      '<format attr="field" value="[orders].[sum:Profit:qk]"/>',
    );
    const changedAnalyticalFormat = analyticalFormat.replace(
      '[orders].[sum:Profit:qk]',
      '[orders].[avg:Profit:qk]',
    );

    expect(analyticalFingerprint(changedAnalyticalFormat)).not.toBe(
      analyticalFingerprint(analyticalFormat),
    );
  });

  it('preserves an unknown namespaced child nested in a presentation format', () => {
    const nestedAnalyticalFormat = baseXml.replace(
      '<format attr="color" value="#111111"/>',
      '<format attr="color" value="#111111"><ext:semantic mode="strict"/></format>',
    );
    const changedNestedChild = nestedAnalyticalFormat.replace(
      '<ext:semantic mode="strict"/>',
      '<ext:semantic mode="lenient"/>',
    );

    expect(analyticalFingerprint(changedNestedChild)).not.toBe(
      analyticalFingerprint(nestedAnalyticalFormat),
    );
  });

  it('does not ignore a presentation format unless it has exactly attr and value attributes', () => {
    const missingValue = baseXml.replace(
      '<format attr="color" value="#111111"/>',
      '<format attr="color"/>',
    );
    const missingFormat = baseXml.replace(
      '<style><style-rule element="all"><format attr="color" value="#111111"/></style-rule></style>',
      '',
    );

    expect(analyticalFingerprint(missingValue)).not.toBe(analyticalFingerprint(missingFormat));
  });

  it('keeps unsupported zone-style values analytical', () => {
    const padded = baseXml.replace(
      '<dashboard name="Overview">',
      '<dashboard name="Overview"><zone-style><format attr="padding" value="8"/></zone-style>',
    );
    const repadded = padded.replace('attr="padding" value="8"', 'attr="padding" value="16"');

    expect(analyticalFingerprint(repadded)).not.toBe(analyticalFingerprint(padded));
  });

  it('does not ignore title run attributes outside the supported worksheet path', () => {
    const titled = baseXml.replace(
      '<dashboard name="Overview">',
      '<dashboard name="Overview"><layout-options><title><formatted-text><run fontname="Tableau Regular" fontcolor="#111111">Overview</run></formatted-text></title></layout-options>',
    );
    const restyledTitle = titled
      .replace('fontname="Tableau Regular"', 'fontname="Tableau Semibold"')
      .replace('fontcolor="#111111"', 'fontcolor="#ff0000"');

    expect(analyticalFingerprint(restyledTitle)).not.toBe(analyticalFingerprint(titled));
  });

  it('ignores only live-shaped dashboard title run presentation values', () => {
    const restyledTitle = supportedDashboardTitleXml
      .replace('fontname="Tableau Light"', 'fontname="Tableau Semibold"')
      .replace('fontcolor="#1f77b4"', 'fontcolor="#171321"');
    const restyledArbitraryText = supportedDashboardTitleXml.replace(
      'fontname="Arbitrary Light"',
      'fontname="Arbitrary Bold"',
    );

    expect(analyticalFingerprint(restyledTitle)).toBe(
      analyticalFingerprint(supportedDashboardTitleXml),
    );
    expect(analyticalFingerprint(restyledArbitraryText)).not.toBe(
      analyticalFingerprint(supportedDashboardTitleXml),
    );
  });

  it('preserves non-owned run attributes and text as analytical by default', () => {
    const titled = baseXml.replace(
      '<dashboard name="Overview">',
      '<dashboard name="Overview"><layout-options><title><formatted-text><run semantic-role="heading">Overview</run></formatted-text></title></layout-options>',
    );
    const changedAttribute = titled.replace('semantic-role="heading"', 'semantic-role="summary"');
    const changedText = titled.replace('>Overview</run>', '>Executive Overview</run>');

    expect(analyticalFingerprint(changedAttribute)).not.toBe(analyticalFingerprint(titled));
    expect(analyticalFingerprint(changedText)).not.toBe(analyticalFingerprint(titled));
  });

  it('preserves a namespaced zone attribute that collides with an owned local name', () => {
    const withNamespacedX = baseXml.replace('<zone id="1"', '<zone ext:x="source-a" id="1"');
    const changedNamespacedX = withNamespacedX.replace('ext:x="source-a"', 'ext:x="source-b"');

    expect(analyticalFingerprint(changedNamespacedX)).not.toBe(
      analyticalFingerprint(withNamespacedX),
    );
  });

  it('preserves namespaced style elements even when their local names look presentational', () => {
    const namespacedStyle = baseXml.replace(
      '<dashboard name="Overview">',
      '<dashboard name="Overview"><ext:style><ext:style-rule element="all"><ext:format attr="color" value="#111111"/></ext:style-rule></ext:style>',
    );
    const changedNamespacedStyle = namespacedStyle.replace(
      '<ext:format attr="color" value="#111111"/>',
      '<ext:format attr="color" value="#ff0000"/>',
    );

    expect(analyticalFingerprint(changedNamespacedStyle)).not.toBe(
      analyticalFingerprint(namespacedStyle),
    );
  });

  it('preserves namespaced style-container attributes that collide with allowed local names', () => {
    const namespacedSelector = baseXml.replace(
      '<style><style-rule element="all"><format attr="color" value="#111111"/></style-rule></style>',
      '<style><style-rule ext:element="semantic-a"/></style>',
    );
    const changedSelector = namespacedSelector.replace(
      'ext:element="semantic-a"',
      'ext:element="semantic-b"',
    );
    const removedSubtree = namespacedSelector.replace(
      '<style><style-rule ext:element="semantic-a"/></style>',
      '',
    );

    expect(analyticalFingerprint(changedSelector)).not.toBe(
      analyticalFingerprint(namespacedSelector),
    );
    expect(analyticalFingerprint(namespacedSelector)).not.toBe(
      analyticalFingerprint(removedSubtree),
    );
  });

  it('rejects xmldom warning recovery such as an unquoted attribute', () => {
    const warningXml = baseXml.replace(
      '<workbook xmlns:ext="urn:tableau:test">',
      '<workbook xmlns:ext="urn:tableau:test" recovered=yes>',
    );

    expect(() => analyticalFingerprint(warningXml)).toThrow(
      'Cannot fingerprint malformed workbook XML',
    );
  });

  it('rejects malformed XML instead of fingerprinting a parser recovery tree', () => {
    expect(() => analyticalFingerprint('<workbook><worksheets></workbook>')).toThrow(
      'Cannot fingerprint malformed workbook XML',
    );
  });

  it.each([
    ['worksheet title font', 'fontname="Old Title"', 'fontname="Tableau Semibold"'],
    ['worksheet title color', 'fontcolor="#010101"', 'fontcolor="#171321"'],
    [
      'worksheet body font',
      'attr="font-family" value="Old Body"',
      'attr="font-family" value="Tableau Regular"',
    ],
    ['worksheet text color', 'attr="color" value="#020202"', 'attr="color" value="#171321"'],
    [
      'worksheet background',
      'attr="background-color" value="#030303"',
      'attr="background-color" value="#FFFFFF"',
    ],
    ['categorical map color', 'marker="a" to="#111111"', 'marker="a" to="#7759C2"'],
    ['sequential color', '<color>#eeeeee</color>', '<color>#F1ECFF</color>'],
    ['diverging color', '<color>#aa0000</color>', '<color>#D63939</color>'],
  ])('ignores the supported %s presentation value', (_label, before, after) => {
    expect(analyticalFingerprint(supportedStyleXml.replace(before, after))).toBe(
      analyticalFingerprint(supportedStyleXml),
    );
  });

  it.each([
    ['format selector', 'attr="font-family"', 'attr="font-size"'],
    ['style-rule selector', 'element="table"', 'element="cell"'],
    [
      'encoding selector',
      'attr="color" field="[Category]" type="palette"',
      'attr="size" field="[Category]" type="palette"',
    ],
    ['encoding field', 'field="[Category]"', 'field="[Segment]"'],
    ['categorical bucket', '<bucket>&quot;A&quot;</bucket>', '<bucket>&quot;B&quot;</bucket>'],
    [
      'categorical map order',
      '<map marker="a" to="#111111" ext:to="keep"><bucket>&quot;A&quot;</bucket></map><map marker="b" to="#222222"><bucket>&quot;B&quot;</bucket></map>',
      '<map marker="b" to="#222222"><bucket>&quot;B&quot;</bucket></map><map marker="a" to="#111111" ext:to="keep"><bucket>&quot;A&quot;</bucket></map>',
    ],
    [
      'palette count',
      '<color>#111111</color></color-palette>',
      '<color>#111111</color><color>#222222</color></color-palette>',
    ],
    ['unknown attribute', 'marker="a"', 'marker="changed"'],
    ['namespaced attribute', 'ext:semantic="keep"', 'ext:semantic="changed"'],
    ['unknown sibling order', '<ext:before/><style-rule', '<style-rule'],
  ])('changes for semantic %s changes', (_label, before, after) => {
    expect(analyticalFingerprint(supportedStyleXml.replace(before, after))).not.toBe(
      analyticalFingerprint(supportedStyleXml),
    );
  });

  it('does not ignore namespaced collisions at supported presentation paths', () => {
    const changedRun = supportedStyleXml.replace('ext:fontname="keep"', 'ext:fontname="changed"');
    const changedMap = supportedStyleXml.replace('ext:to="keep"', 'ext:to="changed"');
    const changedColor = supportedStyleXml.replace(
      '<ext:color>#semantic</ext:color>',
      '<ext:color>#changed</ext:color>',
    );

    expect(analyticalFingerprint(changedRun)).not.toBe(analyticalFingerprint(supportedStyleXml));
    expect(analyticalFingerprint(changedMap)).not.toBe(analyticalFingerprint(supportedStyleXml));
    expect(analyticalFingerprint(changedColor)).not.toBe(analyticalFingerprint(supportedStyleXml));
  });

  it('exempts supported presentation only on named eligible artifacts', () => {
    const changed = supportedStyleXml.replace('fontname="Old Title"', 'fontname="New Title"');
    const eligible: EligibleStyleArtifact[] = [
      { kind: 'worksheet', id: 'visible-id', name: 'Visible', hidden: false },
    ];

    expect(eligibleStyleScopeFingerprint(changed, eligible)).toBe(
      eligibleStyleScopeFingerprint(supportedStyleXml, eligible),
    );
    expect(eligibleStyleScopeFingerprint(changed, [])).not.toBe(
      eligibleStyleScopeFingerprint(supportedStyleXml, []),
    );
  });

  it('scopes the dashboard title presentation exemption to the eligible dashboard', () => {
    const changed = supportedDashboardTitleXml.replace(
      'fontname="Tableau Light"',
      'fontname="Tableau Semibold"',
    );
    const eligible: EligibleStyleArtifact[] = [
      { kind: 'dashboard', id: 'overview-id', name: 'Sales and Profit Overview', hidden: false },
    ];

    expect(eligibleStyleScopeFingerprint(changed, eligible)).toBe(
      eligibleStyleScopeFingerprint(supportedDashboardTitleXml, eligible),
    );
    expect(eligibleStyleScopeFingerprint(changed, [])).not.toBe(
      eligibleStyleScopeFingerprint(supportedDashboardTitleXml, []),
    );
  });

  it('canonicalizes but retains supported presentation in workbook style state', () => {
    const changed = supportedStyleXml.replace('to="#111111"', 'to="#999999"');
    const serialized = new XMLSerializer().serializeToString(
      new DOMParser().parseFromString(supportedStyleXml, 'text/xml'),
    );

    expect(workbookStyleStateFingerprint(serialized)).toBe(
      workbookStyleStateFingerprint(supportedStyleXml),
    );
    expect(workbookStyleStateFingerprint(changed)).not.toBe(
      workbookStyleStateFingerprint(supportedStyleXml),
    );
  });

  it('excludes unrelated window and focus metadata from workbook style state', () => {
    const first = supportedStyleXml.replace(
      '</workbook>',
      '<windows><window name="Visible" active="true"/></windows></workbook>',
    );
    const normalized = first.replace('active="true"', 'active="false"');

    expect(workbookStyleStateFingerprint(normalized)).toBe(workbookStyleStateFingerprint(first));
    expect(analyticalFingerprint(normalized)).toBe(analyticalFingerprint(first));
  });

  it('ignores unnamespaced active and maximized flips only on unnamespaced window elements', () => {
    const before = supportedStyleXml.replace(
      '</workbook>',
      '<windows><window active="true" maximized="false" name="Visible"/></windows></workbook>',
    );
    const after = before
      .replace('active="true"', 'active="false"')
      .replace('maximized="false"', 'maximized="true"');

    expect(analyticalFingerprint(after)).toBe(analyticalFingerprint(before));
    expect(eligibleStyleScopeFingerprint(after, [])).toBe(
      eligibleStyleScopeFingerprint(before, []),
    );
  });

  it.each([
    [
      'namespaced attribute',
      '<windows><window ext:active="true"/></windows>',
      '<windows><window ext:active="false"/></windows>',
    ],
    [
      'namespaced element',
      '<windows><ext:window active="true"/></windows>',
      '<windows><ext:window active="false"/></windows>',
    ],
    [
      'non-window element',
      '<windows><pane active="true"/></windows>',
      '<windows><pane active="false"/></windows>',
    ],
    [
      'case-distinct attribute',
      '<windows><window Active="true"/></windows>',
      '<windows><window Active="false"/></windows>',
    ],
  ])('retains a %s change in guarded fingerprints', (_label, beforeNode, afterNode) => {
    const before = supportedStyleXml.replace('</workbook>', `${beforeNode}</workbook>`);
    const after = supportedStyleXml.replace('</workbook>', `${afterNode}</workbook>`);

    expect(analyticalFingerprint(after)).not.toBe(analyticalFingerprint(before));
    expect(eligibleStyleScopeFingerprint(after, [])).not.toBe(
      eligibleStyleScopeFingerprint(before, []),
    );
  });

  it.each([
    ['title font', 'fontname="Old Title"', 'fontname="New Title"'],
    ['text color', 'value="#020202"', 'value="#999999"'],
    ['categorical color', 'to="#111111"', 'to="#999999"'],
    ['sequential color', '<color>#eeeeee</color>', '<color>#999999</color>'],
  ])('retains supported %s in workbook style state', (_label, before, after) => {
    expect(workbookStyleStateFingerprint(supportedStyleXml.replace(before, after))).not.toBe(
      workbookStyleStateFingerprint(supportedStyleXml),
    );
  });

  it('retains supported dashboard title values in workbook style state', () => {
    const changed = supportedDashboardTitleXml.replace(
      'fontcolor="#1f77b4"',
      'fontcolor="#171321"',
    );

    expect(workbookStyleStateFingerprint(changed)).not.toBe(
      workbookStyleStateFingerprint(supportedDashboardTitleXml),
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
  ])(
    'keeps color values analytical for an interpolated palette with %s',
    (_label, before, after) => {
      const unsupported = supportedStyleXml.replace(before, after);
      const changedColor = unsupported.replace('<color>#eeeeee</color>', '<color>#changed</color>');

      expect(analyticalFingerprint(changedColor)).not.toBe(analyticalFingerprint(unsupported));
    },
  );
});

const supportedStyleXml =
  '<workbook xmlns:ext="urn:test"><worksheets><worksheet name="Visible"><layout-options><title><formatted-text><run fontname="Old Title" fontcolor="#010101" ext:fontname="keep">Title</run></formatted-text></title></layout-options><table><style><ext:before/><style-rule element="all"><format attr="font-family" value="Old Body"/><format attr="color" value="#020202"/></style-rule><style-rule element="table"><format attr="background-color" value="#030303"/></style-rule><style-rule element="mark" ext:semantic="keep"><encoding attr="color" field="[Category]" type="palette"><map marker="a" to="#111111" ext:to="keep"><bucket>&quot;A&quot;</bucket></map><map marker="b" to="#222222"><bucket>&quot;B&quot;</bucket></map></encoding><encoding attr="color" field="[Sales]" type="custom-interpolated"><color-palette custom="true" type="ordered-sequential"><color>#eeeeee</color><color>#111111</color></color-palette></encoding><encoding attr="color" field="[Profit]" type="custom-interpolated"><color-palette custom="true" type="ordered-diverging"><color>#aa0000</color><color>#ffffff</color><color>#00aa00</color><ext:color>#semantic</ext:color></color-palette></encoding></style-rule></style></table></worksheet></worksheets><dashboards/></workbook>';

const supportedDashboardTitleXml =
  '<workbook xmlns:ext="urn:test"><worksheets/><dashboards><dashboard name="Sales and Profit Overview"><zones><zone type-v2="layout-basic"><zone type-v2="text"><formatted-text><run fontcolor="#1f77b4" fontname="Tableau Light">Sales and Profit Overview</run></formatted-text></zone><zone type-v2="text"><formatted-text><run fontcolor="#222222" fontname="Arbitrary Light">Read the footnote</run></formatted-text></zone></zone></zones></dashboard></dashboards></workbook>';
