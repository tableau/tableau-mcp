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
        <column name="[Revenue/Cost]" datatype="real" role="measure" type="quantitative"/>
        <column name="[Category]" datatype="string" role="dimension" type="nominal"/>
        <column-instance name="[sum:Sales:qk]" column="[Sales]" derivation="Sum" pivot="key" type="quantitative"/>
        <column-instance name="[sum:Profit:qk]" column="[Profit]" derivation="Sum" pivot="key" type="quantitative"/>
        <column-instance name="[sum:Revenue/Cost:qk]" column="[Revenue/Cost]" derivation="Sum" pivot="key" type="quantitative"/>
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

  it('requires datasource-qualified refs when adding to rows', () => {
    expect(() => addFieldToRows(WORKSHEET_XML, '[sum:Profit:qk]')).toThrow(
      /Invalid column reference format/,
    );
  });

  it('keeps the legacy column-instance validation error for datasource-qualified non-instance refs', () => {
    expect(() => addFieldToRows(WORKSHEET_XML, '[Sample].[Profit]')).toThrow(
      /Invalid column-instance name format: \[Profit\]/,
    );
  });

  it('does not split a shelf field name that contains slash characters', () => {
    const slashFieldXml = WORKSHEET_XML.replace(
      '<rows>[Sample].[sum:Sales:qk]</rows>',
      '<rows>[Sample].[sum:Revenue/Cost:qk]</rows>',
    );

    const modified = addFieldToRows(slashFieldXml, '[Sample].[sum:Profit:qk]', 1);
    const rowFields = listFields(modified).filter((f) => f.location === 'rows');

    expect(rowFields.map((f) => f.column)).toEqual([
      '[Sample].[sum:Revenue/Cost:qk]',
      '[Sample].[sum:Profit:qk]',
    ]);
  });

  it('treats index 0 as append-equivalent on an empty shelf', () => {
    const emptyRowsXml = WORKSHEET_XML.replace(
      '<rows>[Sample].[sum:Sales:qk]</rows>',
      '<rows></rows>',
    );

    const explicitZero = addFieldToRows(emptyRowsXml, '[Sample].[sum:Profit:qk]', 0);
    const omittedIndex = addFieldToRows(emptyRowsXml, '[Sample].[sum:Profit:qk]');

    expect(listFields(explicitZero).filter((f) => f.location === 'rows')).toEqual(
      listFields(omittedIndex).filter((f) => f.location === 'rows'),
    );
  });
});

describe('addFieldToRows dotted and colon refs', () => {
  const DOTTED_COLON_XML = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet name="Sheet 1">
  <table>
    <view>
      <datasources>
        <datasource name="Orders.Primary" caption="Orders"/>
      </datasources>
      <datasource-dependencies datasource="Orders.Primary">
        <column name="[City.Region]" datatype="string" role="dimension" type="nominal"/>
        <column name="[Profit:Ratio]" datatype="real" role="measure" type="quantitative"/>
        <column-instance name="[none:City.Region:nk]" column="[City.Region]" derivation="None" pivot="key" type="nominal"/>
      </datasource-dependencies>
    </view>
    <rows>[Orders.Primary].[none:City.Region:nk]</rows>
  </table>
</worksheet>`;

  it('adds a datasource-qualified ref when datasource and field names contain dots or colons', () => {
    const modified = addFieldToRows(DOTTED_COLON_XML, '[Orders.Primary].[sum:Profit:Ratio:qk]');
    const rowFields = listFields(modified).filter((f) => f.location === 'rows');
    expect(rowFields.map((f) => f.column)).toContain('[Orders.Primary].[sum:Profit:Ratio:qk]');
    expect(modified).toContain(
      '<column-instance name="[sum:Profit:Ratio:qk]" column="[Profit:Ratio]"',
    );
  });
});

describe('addFieldToRows date-part derivations', () => {
  // Regression: mapDerivationToProperCase dropped the date-part keys, so a
  // [mn:...] ref was written with derivation="mn" (invalid) and Tableau
  // silently collapsed the date pill, killing YoY/seasonal overlays.
  const DATE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet name="Sheet 1">
  <table>
    <view>
      <datasources>
        <datasource name="Sample" caption="Sample Superstore"/>
      </datasources>
      <datasource-dependencies datasource="Sample">
        <column name="[Order Date]" datatype="date" role="dimension" type="ordinal"/>
        <column-instance name="[none:Order Date:nk]" column="[Order Date]" derivation="None" pivot="key" type="nominal"/>
      </datasource-dependencies>
    </view>
    <rows>[Sample].[none:Order Date:nk]</rows>
  </table>
</worksheet>`;

  function derivationOf(xml: string, columnInstanceName: string): string | undefined {
    const m = xml.match(
      new RegExp(
        `<column-instance[^>]*name="\\[${columnInstanceName}\\]"[^>]*derivation="([^"]*)"`,
      ),
    );
    return m?.[1];
  }

  it('maps the discrete month part [mn:...] to derivation="Month", not "mn"', () => {
    const modified = addFieldToRows(DATE_XML, '[Sample].[mn:Order Date:ok]');
    expect(derivationOf(modified, 'mn:Order Date:ok')).toBe('Month');
  });

  it('maps the truncated year part [tyr:...] to derivation="Year-Trunc"', () => {
    const modified = addFieldToRows(DATE_XML, '[Sample].[tyr:Order Date:qk]');
    expect(derivationOf(modified, 'tyr:Order Date:qk')).toBe('Year-Trunc');
  });

  it('still maps aggregations correctly (sum -> Sum)', () => {
    const modified = addFieldToRows(DATE_XML, '[Sample].[sum:Order Date:qk]');
    expect(derivationOf(modified, 'sum:Order Date:qk')).toBe('Sum');
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

describe('detail encoding normalizes to <lod> (regression: coordinate map single-centroid blank)', () => {
  // W-23447710 follow-up: an agent placed a dimension on the level-of-detail
  // shelf via encoding_type="detail" → the tool wrote <detail>, which Tableau
  // silently strips on apply (canonical LOD tag is <lod>). The pill vanished,
  // the map collapsed to one AVG(lat)/AVG(lon) centroid, and rendered blank.
  // Normalizing detail→lod at the metadata layer keeps the pill on the round-trip.
  it('writes <lod> (not <detail>) when adding a field with encoding_type="detail"', () => {
    const out = addFieldToEncoding(WORKSHEET_XML, 'detail', '[Sample].[none:Category:nk]');
    expect(out).toMatch(/<lod\b[^>]*column=["']\[Sample\]\.\[none:Category:nk\]["']/);
    expect(out).not.toMatch(/<detail\b/);
  });

  it('adding "detail" then "lod" for the same field is a duplicate (they are one shelf)', () => {
    const withDetail = addFieldToEncoding(WORKSHEET_XML, 'detail', '[Sample].[none:Category:nk]');
    // Because detail is normalized to lod, re-adding the same field as lod collides.
    expect(() => addFieldToEncoding(withDetail, 'lod', '[Sample].[none:Category:nk]')).toThrow(
      /already exists/,
    );
  });

  it('removes a lod-shelf field addressed as encoding_type="detail" (add/remove symmetric)', () => {
    const withLod = addFieldToEncoding(WORKSHEET_XML, 'lod', '[Sample].[none:Category:nk]');
    expect(withLod).toMatch(/<lod\b[^>]*column=["']\[Sample\]\.\[none:Category:nk\]["']/);
    // Address the same shelf with the "detail" alias — normalization means it hits <lod>.
    const removed = removeFieldFromEncoding(withLod, 'detail', '[Sample].[none:Category:nk]');
    expect(removed).not.toMatch(/<lod\b/);
  });

  it('leaves other encoding types (color/size) unchanged', () => {
    const out = addFieldToEncoding(WORKSHEET_XML, 'size', '[Sample].[sum:Profit:qk]');
    expect(out).toMatch(/<size\b[^>]*column=["']\[Sample\]\.\[sum:Profit:qk\]["']/);
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
