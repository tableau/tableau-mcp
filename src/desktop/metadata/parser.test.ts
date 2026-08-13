import {
  findAllWorksheets,
  findWorksheet,
  generateUUID,
  normalizeArray,
  parseXML,
  parseXMLPreservingNumericEntities,
  serializeXML,
  serializeXMLPreservingNumericEntities,
} from './parser.js';

const WORKBOOK_TWO_SHEETS = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table></table>
    </worksheet>
    <worksheet name="Sheet 2">
      <table></table>
    </worksheet>
  </worksheets>
</workbook>`;

describe('parseXML', () => {
  it('should parse valid workbook XML and return an object with workbook property', () => {
    const parsed = parseXML(WORKBOOK_TWO_SHEETS);
    expect(parsed).toBeDefined();
    expect(parsed.workbook).toBeDefined();
  });

  it('should handle unclosed tags gracefully without throwing', () => {
    const result = parseXML('<invalid>');
    expect(result).toBeDefined();
  });
});

describe('normalizeArray', () => {
  it('should return empty array for undefined', () => {
    expect(normalizeArray(undefined)).toEqual([]);
  });

  it('should return empty array for null', () => {
    expect(normalizeArray(null as any)).toEqual([]);
  });

  it('should wrap a single non-array object in an array', () => {
    expect(normalizeArray({ foo: 'bar' })).toEqual([{ foo: 'bar' }]);
  });

  it('should return the same array reference when given an array', () => {
    const arr = [{ foo: 'bar' }];
    expect(normalizeArray(arr)).toBe(arr);
  });

  it('should return an empty array when given an empty array', () => {
    expect(normalizeArray([])).toEqual([]);
  });
});

describe('generateUUID', () => {
  it('should produce a UUID wrapped in curly braces', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/i);
  });

  it('should generate unique values on successive calls', () => {
    const uuids = Array.from({ length: 5 }, generateUUID);
    expect(new Set(uuids).size).toBe(5);
  });
});

describe('findWorksheet', () => {
  it('should find an existing worksheet by name', () => {
    const workbook = parseXML(WORKBOOK_TWO_SHEETS);
    const ws = findWorksheet(workbook, 'Sheet 1');
    expect(ws).not.toBeNull();
    expect(ws?.['@_name']).toBe('Sheet 1');
  });

  it('should find the second worksheet by name', () => {
    const workbook = parseXML(WORKBOOK_TWO_SHEETS);
    const ws = findWorksheet(workbook, 'Sheet 2');
    expect(ws?.['@_name']).toBe('Sheet 2');
  });

  it('should return null for a non-existent worksheet name', () => {
    const workbook = parseXML(WORKBOOK_TWO_SHEETS);
    expect(findWorksheet(workbook, 'Does Not Exist')).toBeNull();
  });
});

describe('findAllWorksheets', () => {
  it('should return all worksheets', () => {
    const workbook = parseXML(WORKBOOK_TWO_SHEETS);
    const sheets = findAllWorksheets(workbook);
    expect(sheets).toHaveLength(2);
    const names = sheets.map((ws) => ws['@_name']);
    expect(names).toContain('Sheet 1');
    expect(names).toContain('Sheet 2');
  });

  it('should return an empty array when the workbook has no worksheets', () => {
    const workbook = parseXML('<workbook></workbook>');
    expect(findAllWorksheets(workbook)).toEqual([]);
  });
});

describe('serializeXML', () => {
  it('should produce output that includes the workbook root tags', () => {
    const workbook = parseXML(WORKBOOK_TWO_SHEETS);
    const output = serializeXML(workbook);
    expect(output).toContain('<workbook');
    expect(output).toContain('</workbook>');
  });

  it('should preserve worksheet names through a round-trip', () => {
    const workbook = parseXML(WORKBOOK_TWO_SHEETS);
    const output = serializeXML(workbook);
    expect(output).toContain('Sheet 1');
    expect(output).toContain('Sheet 2');
  });

  it('preserves semantic numeric entities and encoded literal text in the default parser', () => {
    const parsed = parseXML('<column formula="real:&#13; literal:&amp;#13;" />') as any;

    expect(parsed.column[0]['@_formula']).toBe('real:\r literal:&#13;');
    expect(serializeXML(parsed)).toContain('formula="real:&#13; literal:&amp;#13;"');
  });

  it('keeps formatting whitespace literal instead of creating numeric entity churn', () => {
    const output = serializeXML(parseXML('<root>\n  <child />\n</root>'));

    expect(output).not.toContain('&#10;');
  });

  describe('numeric-entity-preserving template round-trip', () => {
    const calc = `<?xml version="1.0" encoding="UTF-8"?>
<workbook><datasources><datasource name="DS">
  <column caption="Order Profitable?" name="[Order Profitable?]">
    <calculation class="tableau" formula="{fixed [Order ID]:sum([Profit])}&gt;0&#13;&#10;// calculates the profit at the order level" />
  </column>
</datasource></datasources></workbook>`;

    it('preserves numeric newline entities instead of double-escaping them', () => {
      const output = serializeXMLPreservingNumericEntities(parseXMLPreservingNumericEntities(calc));
      expect(output).toContain('&gt;0&#13;&#10;// calculates the profit at the order level');
      expect(output).not.toContain('&amp;#13;');
      expect(output).not.toContain('&amp;#10;');
    });

    it('does not progressively escape the formula on a second round-trip', () => {
      const once = serializeXMLPreservingNumericEntities(parseXMLPreservingNumericEntities(calc));
      const twice = serializeXMLPreservingNumericEntities(parseXMLPreservingNumericEntities(once));
      const formula = /formula="([^"]*)"/;
      expect(twice.match(formula)?.[1]).toBe(once.match(formula)?.[1]);
    });

    it('keeps encoded literal numeric-entity text inert while preserving real newlines', () => {
      const source =
        '<column formula="literal &amp;#0; text, then a real newline: &#13;&#10;next" />';
      const once = serializeXMLPreservingNumericEntities(parseXMLPreservingNumericEntities(source));
      const twice = serializeXMLPreservingNumericEntities(parseXMLPreservingNumericEntities(once));

      expect(once).toContain('literal &amp;#0; text, then a real newline: &#13;&#10;next');
      expect(once).not.toContain('literal &#0; text');
      expect(twice).toBe(once);
    });

    it('does not treat sentinel-shaped user text as protected parser state', () => {
      const sentinelText = '\uE000TABLEAU_NUMERIC_ENTITY_user_text_13\uE001';
      const once = serializeXMLPreservingNumericEntities(
        parseXMLPreservingNumericEntities(`<r>${sentinelText}</r>`),
      );

      expect(once).toBe(`<r>${sentinelText}</r>`);
      expect(once).not.toContain('&#13;');
    });

    it('does not reinterpret encoded entity text inside CDATA', () => {
      const once = serializeXMLPreservingNumericEntities(
        parseXMLPreservingNumericEntities('<r><![CDATA[&amp;#13;]]></r>'),
      );
      const twice = serializeXMLPreservingNumericEntities(parseXMLPreservingNumericEntities(once));

      expect(once).toBe('<r>&amp;amp;#13;</r>');
      expect(twice).toBe(once);
    });

    it('parses identical source into deeply equal values across calls', () => {
      const source = '<column formula="literal &amp;#13; text" />';

      expect(parseXMLPreservingNumericEntities(source)).toEqual(
        parseXMLPreservingNumericEntities(source),
      );
    });

    it('returns semantic control characters and no parser sentinels', () => {
      const parsed = parseXMLPreservingNumericEntities(
        '<column formula="real:&#13;&#10;&#9; literal:&amp;#13;" />',
      ) as any;

      expect(parsed.column[0]['@_formula']).toBe('real:\r\n\t literal:&#13;');
      expect(JSON.stringify(parsed)).not.toContain('TABLEAU_NUMERIC_ENTITY');
    });

    it('serializes semantic CR, LF, and tab separately from literal numeric-entity text', () => {
      const parsed = parseXMLPreservingNumericEntities(
        '<column formula="real:&#13;&#10;&#9; literal:&amp;#13;" />',
      );

      expect(serializeXMLPreservingNumericEntities(parsed)).toContain(
        'formula="real:&#13;&#10;&#9; literal:&amp;#13;"',
      );
    });

    it('does not place numeric-entity sentinels inside CDATA', () => {
      const parsed = parseXMLPreservingNumericEntities('<r><![CDATA[&#13;&amp;#13;]]></r>') as any;

      expect(parsed.r).toBe('&#13;&amp;#13;');
      expect(JSON.stringify(parsed)).not.toContain('TABLEAU_NUMERIC_ENTITY');
    });
  });
});
