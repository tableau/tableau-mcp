import {
  addFieldToCols,
  addFieldToEncoding,
  addFieldToRows,
  listFields,
  moveFieldInCols,
  moveFieldInEncoding,
  moveFieldInRows,
  removeFieldFromCols,
  removeFieldFromEncoding,
  removeFieldFromRows,
} from './fields.js';

// Minimal worksheet XML with one row field, one col field, and one color encoding
const WORKSHEET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet name="Sheet 1">
  <table>
    <view>
      <datasources>
        <datasource name="Sample" caption="Sample Superstore"/>
      </datasources>
      <datasource-dependencies datasource="Sample">
        <column name="[Sales]" datatype="real" role="measure" type="quantitative"/>
        <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
        <column name="[Category]" datatype="string" role="dimension" type="nominal"/>
        <column-instance name="[sum:Sales:qk]" column="[Sales]" derivation="Sum" pivot="key" type="quantitative"/>
        <column-instance name="[sum:Profit:qk]" column="[Profit]" derivation="Sum" pivot="key" type="quantitative"/>
        <column-instance name="[none:Category:nk]" column="[Category]" derivation="None" pivot="key" type="nominal"/>
      </datasource-dependencies>
    </view>
    <rows>[Sample].[sum:Sales:qk]</rows>
    <cols>[Sample].[none:Category:nk]</cols>
    <panes>
      <pane>
        <encodings>
          <color column="[Sample].[none:Category:nk]"/>
        </encodings>
      </pane>
    </panes>
  </table>
</worksheet>`;

describe('listFields', () => {
  it('should return fields from all locations', () => {
    const fields = listFields(WORKSHEET_XML);
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it('should find the color encoding field', () => {
    const fields = listFields(WORKSHEET_XML);
    const colorField = fields.find((f) => f.location === 'encodings' && f.encodingType === 'color');
    expect(colorField).toBeDefined();
    expect(colorField?.column).toBe('[Sample].[none:Category:nk]');
  });

  it('should find the rows field', () => {
    const fields = listFields(WORKSHEET_XML);
    const rowsField = fields.find((f) => f.location === 'rows');
    expect(rowsField).toBeDefined();
    expect(rowsField?.column).toBe('[Sample].[sum:Sales:qk]');
  });

  it('should find the cols field', () => {
    const fields = listFields(WORKSHEET_XML);
    const colsField = fields.find((f) => f.location === 'cols');
    expect(colsField).toBeDefined();
    expect(colsField?.column).toBe('[Sample].[none:Category:nk]');
  });

  it('should return an empty array for a worksheet with no fields', () => {
    const emptyXml = '<worksheet name="Empty"><table></table></worksheet>';
    expect(listFields(emptyXml)).toEqual([]);
  });
});

describe('addFieldToRows / removeFieldFromRows', () => {
  it('should add a field to rows', () => {
    const modified = addFieldToRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]');
    const fields = listFields(modified);
    const rowFields = fields.filter((f) => f.location === 'rows');
    expect(rowFields).toHaveLength(2);
  });

  it('should add a field to rows at a specific index', () => {
    const modified = addFieldToRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]', 0);
    const fields = listFields(modified);
    const rowFields = fields.filter((f) => f.location === 'rows');
    expect(rowFields[0]?.column).toBe('[Sample].[sum:Profit:qk]');
  });

  it('should remove an existing field from rows', () => {
    const modified = removeFieldFromRows(WORKSHEET_XML, '[Sample].[sum:Sales:qk]');
    const fields = listFields(modified);
    const rowFields = fields.filter((f) => f.location === 'rows');
    expect(rowFields).toHaveLength(0);
  });

  it('should throw when removing a field not on rows', () => {
    expect(() => removeFieldFromRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]')).toThrow();
  });

  it('should round-trip: add then remove leaves rows unchanged', () => {
    const added = addFieldToRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]');
    const restored = removeFieldFromRows(added, '[Sample].[sum:Profit:qk]');
    const fields = listFields(restored);
    const rowFields = fields.filter((f) => f.location === 'rows');
    expect(rowFields).toHaveLength(1);
    expect(rowFields[0]?.column).toBe('[Sample].[sum:Sales:qk]');
  });
});

describe('addFieldToCols / removeFieldFromCols', () => {
  it('should add a field to cols', () => {
    const modified = addFieldToCols(WORKSHEET_XML, '[Sample].[sum:Profit:qk]');
    const fields = listFields(modified);
    const colFields = fields.filter((f) => f.location === 'cols');
    expect(colFields).toHaveLength(2);
  });

  it('should remove an existing field from cols', () => {
    const modified = removeFieldFromCols(WORKSHEET_XML, '[Sample].[none:Category:nk]');
    const fields = listFields(modified);
    const colFields = fields.filter((f) => f.location === 'cols');
    expect(colFields).toHaveLength(0);
  });

  it('should throw when removing a field not on cols', () => {
    expect(() => removeFieldFromCols(WORKSHEET_XML, '[Sample].[sum:Profit:qk]')).toThrow();
  });
});

describe('addFieldToEncoding / removeFieldFromEncoding', () => {
  it('should add a field to an encoding', () => {
    const modified = addFieldToEncoding(WORKSHEET_XML, 'size', '[Sample].[sum:Sales:qk]');
    const fields = listFields(modified);
    const sizeField = fields.find((f) => f.location === 'encodings' && f.encodingType === 'size');
    expect(sizeField).toBeDefined();
    expect(sizeField?.column).toBe('[Sample].[sum:Sales:qk]');
  });

  it('should throw when adding a duplicate encoding', () => {
    expect(() =>
      addFieldToEncoding(WORKSHEET_XML, 'color', '[Sample].[none:Category:nk]'),
    ).toThrow();
  });

  it('should remove a field from an encoding', () => {
    const modified = removeFieldFromEncoding(WORKSHEET_XML, 'color', '[Sample].[none:Category:nk]');
    const fields = listFields(modified);
    const colorField = fields.find((f) => f.location === 'encodings' && f.encodingType === 'color');
    expect(colorField).toBeUndefined();
  });

  it('should throw when removing a non-existent encoding', () => {
    expect(() =>
      removeFieldFromEncoding(WORKSHEET_XML, 'size', '[Sample].[sum:Sales:qk]'),
    ).toThrow();
  });
});

describe('moveFieldInRows', () => {
  it('should move a field to a new position', () => {
    const twoRowsXml = addFieldToRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]');
    const moved = moveFieldInRows(twoRowsXml, '[Sample].[sum:Profit:qk]', 0);
    const fields = listFields(moved).filter((f) => f.location === 'rows');
    expect(fields[0]?.column).toBe('[Sample].[sum:Profit:qk]');
  });

  it('should throw when moving to an invalid index', () => {
    const twoRowsXml = addFieldToRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]');
    expect(() => moveFieldInRows(twoRowsXml, '[Sample].[sum:Profit:qk]', 99)).toThrow();
  });

  it('should throw when field is not on rows', () => {
    expect(() => moveFieldInRows(WORKSHEET_XML, '[Sample].[sum:Profit:qk]', 0)).toThrow();
  });
});

describe('moveFieldInCols', () => {
  it('should move a col field to position 0', () => {
    const twoColsXml = addFieldToCols(WORKSHEET_XML, '[Sample].[sum:Profit:qk]');
    const moved = moveFieldInCols(twoColsXml, '[Sample].[sum:Profit:qk]', 0);
    const fields = listFields(moved).filter((f) => f.location === 'cols');
    expect(fields[0]?.column).toBe('[Sample].[sum:Profit:qk]');
  });
});

describe('moveFieldInEncoding', () => {
  it('should move an encoding field to position 0', () => {
    const withSize = addFieldToEncoding(WORKSHEET_XML, 'color', '[Sample].[sum:Sales:qk]');
    const moved = moveFieldInEncoding(withSize, 'color', '[Sample].[sum:Sales:qk]', 0);
    const fields = listFields(moved).filter(
      (f) => f.location === 'encodings' && f.encodingType === 'color',
    );
    expect(fields[0]?.column).toBe('[Sample].[sum:Sales:qk]');
  });

  it('should throw when field is not in encoding', () => {
    expect(() =>
      moveFieldInEncoding(WORKSHEET_XML, 'color', '[Sample].[sum:Sales:qk]', 0),
    ).toThrow();
  });
});
