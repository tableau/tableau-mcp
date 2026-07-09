import {
  buildColumnRef,
  findAndBuildColumnRef,
  findField,
  listAvailableFields,
} from './field-builder.js';
import { AggregationType } from './types.js';

// Workbook XML with two fields in a datasource used by a worksheet
const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="Sample" caption="Sample Superstore">
      <column name="[Sales]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Category]" datatype="string" role="dimension" type="nominal"/>
      <column name="[Profit Ratio]" datatype="real" role="measure" type="quantitative" caption="Profit Ratio">
        <calculation class="tableau" formula="SUM([Profit])/SUM([Sales])"/>
      </column>
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <datasources>
            <datasource name="Sample" caption="Sample Superstore"/>
          </datasources>
          <datasource-dependencies datasource="Sample">
            <column name="[Sales]" datatype="real" role="measure" type="quantitative"/>
            <column name="[Category]" datatype="string" role="dimension" type="nominal"/>
            <column-instance name="[sum:Sales:qk]" column="[Sales]" derivation="Sum" pivot="key" type="quantitative"/>
            <column-instance name="[none:Category:nk]" column="[Category]" derivation="None" pivot="key" type="nominal"/>
          </datasource-dependencies>
        </view>
        <rows>[Sample].[sum:Sales:qk]</rows>
        <cols>[Sample].[none:Category:nk]</cols>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;

describe('findField', () => {
  it('should find a measure by name and default to Sum aggregation', () => {
    const result = findField(WORKBOOK_XML, 'Sales');
    expect(result).not.toBeNull();
    expect(result?.columnName).toBe('[Sales]');
    expect(result?.role).toBe('measure');
    expect(result?.derivation).toBe(AggregationType.Sum);
  });

  it('should find a dimension by name and default to None aggregation', () => {
    const result = findField(WORKBOOK_XML, 'Category');
    expect(result).not.toBeNull();
    expect(result?.columnName).toBe('[Category]');
    expect(result?.role).toBe('dimension');
    expect(result?.derivation).toBe(AggregationType.None);
  });

  it('should parse "sum of Sales" as Sum aggregation', () => {
    const result = findField(WORKBOOK_XML, 'sum of Sales');
    expect(result).not.toBeNull();
    expect(result?.derivation).toBe(AggregationType.Sum);
    expect(result?.columnName).toBe('[Sales]');
  });

  it('should parse "avg of Sales" as Avg aggregation', () => {
    const result = findField(WORKBOOK_XML, 'avg of Sales');
    expect(result).not.toBeNull();
    expect(result?.derivation).toBe(AggregationType.Avg);
  });

  it('should accept an explicit aggregation override', () => {
    const result = findField(WORKBOOK_XML, 'Sales', AggregationType.Max);
    expect(result).not.toBeNull();
    expect(result?.derivation).toBe(AggregationType.Max);
  });

  it('should return null for an unknown field name', () => {
    expect(findField(WORKBOOK_XML, 'NonExistentField')).toBeNull();
  });

  it('should strip brackets from input like "[Sales]"', () => {
    const result = findField(WORKBOOK_XML, '[Sales]');
    expect(result).not.toBeNull();
    expect(result?.columnName).toBe('[Sales]');
  });

  it('should return null when workbook has no worksheets', () => {
    const noWorksheets = '<workbook><datasources></datasources></workbook>';
    expect(findField(noWorksheets, 'Sales')).toBeNull();
  });
});

describe('buildColumnRef', () => {
  it('should construct a column reference in [Datasource].[instance] format', () => {
    const ref = buildColumnRef({
      datasource: 'Sample',
      columnName: '[Sales]',
      columnInstanceName: '[sum:Sales:qk]',
      derivation: AggregationType.Sum,
      type: 'quantitative',
      role: 'measure',
      datatype: 'real',
    });
    expect(ref).toBe('[Sample].[sum:Sales:qk]');
  });
});

describe('findAndBuildColumnRef', () => {
  it('should return a column ref string for an existing field', () => {
    const ref = findAndBuildColumnRef(WORKBOOK_XML, 'Sales');
    expect(ref).not.toBeNull();
    expect(ref).toContain('[Sample]');
    expect(ref).toContain('[sum:Sales:qk]');
  });

  it('should return null for a field that does not exist', () => {
    expect(findAndBuildColumnRef(WORKBOOK_XML, 'Ghost')).toBeNull();
  });
});

describe('listAvailableFields', () => {
  it('should return an array of field objects', () => {
    const fields = listAvailableFields(WORKBOOK_XML);
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it('should include required properties for each field', () => {
    const fields = listAvailableFields(WORKBOOK_XML);
    for (const f of fields) {
      expect(f.datasource).toBeDefined();
      expect(f.columnName).toBeDefined();
      expect(f.columnInstanceName).toBeDefined();
      expect(f.column_ref).toBeDefined();
      expect(f.role).toBeDefined();
      expect(f.type).toBeDefined();
    }
  });

  it('should identify Sales as a quantitative measure', () => {
    const fields = listAvailableFields(WORKBOOK_XML);
    const sales = fields.find((f) => f.columnName === '[Sales]');
    expect(sales).toBeDefined();
    expect(sales?.role).toBe('measure');
    expect(sales?.type).toBe('quantitative');
  });

  it('should identify Category as a dimension', () => {
    const fields = listAvailableFields(WORKBOOK_XML);
    const cat = fields.find((f) => f.columnName === '[Category]');
    expect(cat).toBeDefined();
    expect(cat?.role).toBe('dimension');
  });

  it('should flag calculated fields with aggregation in their formula as isAggregated', () => {
    const fields = listAvailableFields(WORKBOOK_XML);
    const profitRatio = fields.find((f) => f.columnName === '[Profit Ratio]');
    expect(profitRatio).toBeDefined();
    expect(profitRatio?.isAggregated).toBe(true);
    expect(profitRatio?.formula).toBeDefined();
  });

  it('should return an empty array when the workbook has no datasources', () => {
    const noDsXml = '<workbook></workbook>';
    expect(listAvailableFields(noDsXml)).toEqual([]);
  });

  it('should skip the Parameters datasource', () => {
    const withParams = `<workbook>
      <datasources>
        <datasource name="Parameters">
          <column name="[P1]" datatype="real" role="measure" type="quantitative"/>
        </datasource>
      </datasources>
    </workbook>`;
    const fields = listAvailableFields(withParams);
    expect(fields.find((f) => f.datasource === 'Parameters')).toBeUndefined();
  });
});
