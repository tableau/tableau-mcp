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

describe('resolveShelfField', () => {
  it('returns an on-shelf column-instance token verbatim', () => {
    const result = resolveShelfField(WORKSHEET_XML, '[Sample - Superstore].[sum:Sales:qk]');
    expect(result).toEqual({
      ok: true,
      column: '[Sample - Superstore].[sum:Sales:qk]',
      type: 'quantitative',
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
      onShelf: [
        '[Sample - Superstore].[none:Region:nk]',
        '[Sample - Superstore].[usr:Calc:ok:20]',
        '[Sample - Superstore].[usr:Calc_ProfitTier:nk]',
        '[Sample - Superstore].[sum:Sales:qk]',
      ],
    });
  });
});
