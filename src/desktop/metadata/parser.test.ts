import {
  findAllWorksheets,
  findWorksheet,
  generateUUID,
  normalizeArray,
  parseXML,
  serializeXML,
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
});
