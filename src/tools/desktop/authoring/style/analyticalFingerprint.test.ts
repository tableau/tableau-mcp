import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { analyticalFingerprint } from './analyticalFingerprint.js';

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

  it('ignores only style-owned presentation changes', () => {
    const restyled = baseXml
      .replace('#111111', '#ff0000')
      .replace(
        '<dashboard name="Overview">',
        '<dashboard name="Overview"><style><style-rule element="dashboard"><format attr="background" value="#ffffff"/></style-rule></style>',
      )
      .replace('x="0" y="0" w="50000" h="50000"', 'x="500" y="1000" w="49000" h="48000"');

    expect(analyticalFingerprint(restyled)).toBe(analyticalFingerprint(baseXml));
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

  it('ignores a presentation leaf value owned by zone-style', () => {
    const padded = baseXml.replace(
      '<dashboard name="Overview">',
      '<dashboard name="Overview"><zone-style><format attr="padding" value="8"/></zone-style>',
    );
    const repadded = padded.replace('attr="padding" value="8"', 'attr="padding" value="16"');

    expect(analyticalFingerprint(repadded)).toBe(analyticalFingerprint(padded));
  });

  it('ignores style-owned run attributes while preserving the run itself', () => {
    const titled = baseXml.replace(
      '<dashboard name="Overview">',
      '<dashboard name="Overview"><layout-options><title><formatted-text><run fontname="Tableau Regular" fontcolor="#111111">Overview</run></formatted-text></title></layout-options>',
    );
    const restyledTitle = titled
      .replace('fontname="Tableau Regular"', 'fontname="Tableau Semibold"')
      .replace('fontcolor="#111111"', 'fontcolor="#ff0000"');

    expect(analyticalFingerprint(restyledTitle)).toBe(analyticalFingerprint(titled));
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
});
