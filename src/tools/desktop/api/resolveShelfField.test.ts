import { resolveShelfField } from './resolveShelfField.js';

const WORKSHEET_XML = `<?xml version="1.0"?>
<worksheet name="Sales by Region">
  <table>
    <view>
      <datasources><datasource name="Sample - Superstore" /></datasources>
      <datasource-dependencies datasource="Sample - Superstore">
        <column caption="Profit Tier" datatype="string" name="[Calc_ProfitTier]" role="dimension" type="nominal" />
        <column-instance column="[Region]" derivation="None" name="[none:Region:nk]" pivot="key" type="nominal" />
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative" />
        <column-instance column="[Calc]" derivation="User" name="[usr:Calc:ok:20]" pivot="key" type="ordinal" />
        <column-instance column="[Calc_ProfitTier]" derivation="User" name="[usr:Calc_ProfitTier:nk]" pivot="key" type="nominal" />
      </datasource-dependencies>
    </view>
    <rows>[Sample - Superstore].[none:Region:nk] / [Sample - Superstore].[usr:Calc:ok:20] / [Sample - Superstore].[usr:Calc_ProfitTier:nk]</rows>
    <cols>[Sample - Superstore].[sum:Sales:qk]</cols>
  </table>
</worksheet>`;

const TWO_DATE_LEVELS_WORKSHEET_XML = `<?xml version="1.0"?>
<worksheet name="Sales by Order Date">
  <table>
    <view>
      <datasources><datasource name="Sample - Superstore" /></datasources>
      <datasource-dependencies datasource="Sample - Superstore">
        <column caption="Order Date" datatype="date" name="[Order Date]" role="dimension" type="ordinal" />
        <column-instance column="[Order Date]" derivation="Year" name="[yr:Order Date:ok]" pivot="key" type="ordinal" />
        <column-instance column="[Order Date]" derivation="Quarter" name="[qr:Order Date:ok]" pivot="key" type="ordinal" />
      </datasource-dependencies>
    </view>
    <rows>[Sample - Superstore].[yr:Order Date:ok]</rows>
    <cols>[Sample - Superstore].[qr:Order Date:ok]</cols>
  </table>
</worksheet>`;

const SALES_SUM = '[Sample - Superstore].[sum:Sales:qk]';
const SALES_AVG = '[Sample - Superstore].[avg:Sales:qk]';
const AMBIGUOUS_WORKSHEET_XML = WORKSHEET_XML.replace(
  `<cols>${SALES_SUM}</cols>`,
  `<cols>${SALES_SUM} / ${SALES_AVG}</cols>`,
);

describe('resolveShelfField', () => {
  it('returns an on-shelf column-instance token verbatim', () => {
    const result = resolveShelfField(WORKSHEET_XML, '[Sample - Superstore].[sum:Sales:qk]');
    expect(result).toEqual({
      ok: true,
      column: '[Sample - Superstore].[sum:Sales:qk]',
      type: 'quantitative',
    });
  });

  it('returns an exact canonical date-level token when its base field is ambiguous', () => {
    expect(
      resolveShelfField(TWO_DATE_LEVELS_WORKSHEET_XML, '[Sample - Superstore].[qr:Order Date:ok]'),
    ).toEqual({
      ok: true,
      column: '[Sample - Superstore].[qr:Order Date:ok]',
      type: 'ordinal',
    });
  });

  it('reports every matching canonical token when two shelf pills share a base field', () => {
    expect(resolveShelfField(TWO_DATE_LEVELS_WORKSHEET_XML, 'Order Date')).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates: [
        '[Sample - Superstore].[yr:Order Date:ok]',
        '[Sample - Superstore].[qr:Order Date:ok]',
      ],
    });
  });

  it('resolves a plain field name to its on-shelf token', () => {
    const result = resolveShelfField(WORKSHEET_XML, 'Sales');
    expect(result).toEqual({
      ok: true,
      column: '[Sample - Superstore].[sum:Sales:qk]',
      type: 'quantitative',
    });
  });

  it('matches case-insensitively and tolerates surrounding brackets', () => {
    expect(resolveShelfField(WORKSHEET_XML, 'region')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[none:Region:nk]',
      type: 'nominal',
    });
    expect(resolveShelfField(WORKSHEET_XML, '[Region]')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[none:Region:nk]',
      type: 'nominal',
    });
  });

  it('classifies a declared ordinal shelf calculation whose token has an extra colon', () => {
    expect(resolveShelfField(WORKSHEET_XML, 'Calc')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[usr:Calc:ok:20]',
      type: 'ordinal',
    });
  });

  it('resolves a calculated shelf field by its base column caption', () => {
    expect(resolveShelfField(WORKSHEET_XML, 'Profit Tier')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[usr:Calc_ProfitTier:nk]',
      type: 'nominal',
    });
  });

  it('classifies fields under a direct workbook worksheet root', () => {
    const workbookXml = `<workbook>${WORKSHEET_XML.replace('<?xml version="1.0"?>', '')}</workbook>`;
    expect(resolveShelfField(workbookXml, 'Profit Tier')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[usr:Calc_ProfitTier:nk]',
      type: 'nominal',
    });
  });

  it('reports the on-shelf fields when the requested field is absent', () => {
    const result = resolveShelfField(WORKSHEET_XML, 'Discount');
    expect(result).toEqual({
      ok: false,
      reason: 'not_found',
      onShelf: [
        '[Sample - Superstore].[none:Region:nk]',
        '[Sample - Superstore].[usr:Calc:ok:20]',
        '[Sample - Superstore].[usr:Calc_ProfitTier:nk]',
        '[Sample - Superstore].[sum:Sales:qk]',
      ],
    });
  });

  it('reports every distinct canonical candidate when a plain field name is ambiguous', () => {
    expect(resolveShelfField(AMBIGUOUS_WORKSHEET_XML, 'Sales')).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates: [SALES_SUM, SALES_AVG],
    });
  });

  it.each([
    [SALES_SUM, 'quantitative'],
    [SALES_AVG, undefined],
  ])('accepts exact canonical candidate %s', (column, type) => {
    expect(resolveShelfField(AMBIGUOUS_WORKSHEET_XML, column)).toEqual({ ok: true, column, type });
  });

  it('does not treat repeated occurrences of one canonical field as ambiguous', () => {
    const duplicateWorksheetXml = WORKSHEET_XML.replace(
      '<rows>[Sample - Superstore].[none:Region:nk]</rows>',
      `<rows>${SALES_SUM}</rows>`,
    );

    expect(resolveShelfField(duplicateWorksheetXml, 'Sales')).toEqual({
      ok: true,
      column: SALES_SUM,
      type: 'quantitative',
    });
  });
});
