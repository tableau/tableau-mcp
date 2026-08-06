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

  it('matches repeated encoded literals semantically without exposing parser markers', () => {
    const workbook = `<workbook><worksheets><worksheet name="Sheet"><table><view>
      <datasources><datasource name="DS &amp;#13;" /></datasources>
      <datasource-dependencies datasource="DS &amp;#13;">
        <column name="[Literal &amp;#13;]" datatype="string" role="dimension" type="nominal" />
        <column-instance name="[none:Literal &amp;#13;:nk]" column="[Literal &amp;#13;]" derivation="None" />
      </datasource-dependencies>
    </view></table></worksheet></worksheets></workbook>`;

    expect(findField(workbook, 'Literal &#13;')).toEqual(
      expect.objectContaining({
        datasource: 'DS &#13;',
        columnName: '[Literal &#13;]',
        columnInstanceName: '[none:Literal &#13;:nk]',
      }),
    );
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

  it('projects encoded numeric-entity literals as semantic formula text without markers', () => {
    const xml = `<workbook><datasources><datasource name="DS">
      <column name="[Literal]" role="dimension" type="nominal" datatype="string">
        <calculation class="tableau" formula="&quot;literal &amp;#13;&quot;" />
      </column>
    </datasource></datasources></workbook>`;

    const literal = listAvailableFields(xml).find((field) => field.columnName === '[Literal]');

    expect(literal?.formula).toBe('"literal &#13;"');
    expect(literal?.formula).not.toContain('TABLEAU_NUMERIC_ENTITY');
  });

  it('does not expose parser provenance markers in field metadata', () => {
    const xml = `<workbook><datasources><datasource name="DS &amp;#13;">
      <column name="[Literal &amp;#13;]" caption="Caption &amp;#13;" role="dimension" type="nominal" datatype="string" />
    </datasource></datasources></workbook>`;

    expect(listAvailableFields(xml)).toEqual([
      expect.objectContaining({
        datasource: 'DS &#13;',
        columnName: '[Literal &#13;]',
        caption: 'Caption &#13;',
        column_ref: '[DS &#13;].[none:Literal &#13;:nk]',
      }),
    ]);
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

  it('should preserve Tableau semantic-role attributes on available fields', () => {
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='GeoDS'>
      <column name='[Territory]' role='dimension' type='nominal' datatype='string' semantic-role='[State].[Name]' />
      <column name='[MRR]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;
    const availableFields = listAvailableFields(xml);
    const territory = availableFields.find((f) => f.columnName === '[Territory]');
    expect(territory?.semanticRole).toBe('[State].[Name]');
    const mrr = availableFields.find((f) => f.columnName === '[MRR]');
    expect(mrr?.semanticRole).toBeUndefined();
  });

  it('projects measured distinct counts and group metadata without losing table metadata', () => {
    const xml = `<?xml version='1.0'?>
<workbook><datasources><datasource name='DS'>
  <column name='[Region]' role='dimension' type='nominal' datatype='string' />
  <column name='[Region Group]' role='dimension' type='nominal' datatype='string'>
    <calculation class='categorical-bin' column='[Region]' />
  </column>
  <connection><metadata-records>
    <metadata-record class='column'>
      <local-name>[Region]</local-name><local-type>string</local-type>
      <parent-name>[Orders]</parent-name><approx-count> 17 </approx-count>
    </metadata-record>
  </metadata-records></connection>
</datasource></datasources></workbook>`;

    const fields = listAvailableFields(xml);
    expect(fields.find((candidate) => candidate.columnName === '[Region]')).toMatchObject({
      table: '[Orders]',
      approxCount: 17,
    });
    expect(fields.find((candidate) => candidate.columnName === '[Region Group]')?.isGroup).toBe(
      true,
    );
  });

  it('ignores malformed distinct counts instead of guessing', () => {
    const xml = `<workbook><datasources><datasource name='DS'><connection><metadata-records>
      <metadata-record class='column'><local-name>[Bad]</local-name><local-type>string</local-type><approx-count>12.5</approx-count></metadata-record>
    </metadata-records></connection></datasource></datasources></workbook>`;
    expect(listAvailableFields(xml)[0]?.approxCount).toBeUndefined();
  });

  it('projects metadata-record parent-name onto top-level columns', () => {
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='teams+'>
      <column name='[country_code]' caption='Country Code' role='dimension' type='nominal' datatype='string' />
      <column name='[goals]' caption='Goals' role='measure' type='quantitative' datatype='integer' />
      <connection>
        <metadata-records>
          <metadata-record class='column'>
            <local-name>[country_code]</local-name>
            <parent-name>[teams.csv]</parent-name>
          </metadata-record>
          <metadata-record class='column'>
            <local-name>[goals]</local-name>
            <parent-name>[players.csv]</parent-name>
          </metadata-record>
        </metadata-records>
      </connection>
    </datasource>
  </datasources>
</workbook>`;

    const availableFields = listAvailableFields(xml);

    expect(availableFields.find((f) => f.columnName === '[country_code]')?.table).toBe(
      '[teams.csv]',
    );
    expect(availableFields.find((f) => f.columnName === '[goals]')?.table).toBe('[players.csv]');
  });

  it('leaves table undefined when metadata-record parent-name is absent', () => {
    const fields = listAvailableFields(WORKBOOK_XML);
    expect(fields.every((field) => field.table === undefined)).toBe(true);
  });
});
