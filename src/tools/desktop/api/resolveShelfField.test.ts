import { resolveShelfField } from './resolveShelfField.js';

const WORKSHEET_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sales by Region"><table>' +
  '<rows>[Sample - Superstore].[none:Region:nk]</rows>' +
  '<cols>[Sample - Superstore].[sum:Sales:qk]</cols>' +
  '</table></worksheet>';

const SALES_SUM = '[Sample - Superstore].[sum:Sales:qk]';
const SALES_AVG = '[Sample - Superstore].[avg:Sales:qk]';
const AMBIGUOUS_WORKSHEET_XML = WORKSHEET_XML.replace(
  `<cols>${SALES_SUM}</cols>`,
  `<cols>${SALES_SUM} / ${SALES_AVG}</cols>`,
);

describe('resolveShelfField', () => {
  it('returns an on-shelf column-instance token verbatim', () => {
    const result = resolveShelfField(WORKSHEET_XML, '[Sample - Superstore].[sum:Sales:qk]');
    expect(result).toEqual({ ok: true, column: '[Sample - Superstore].[sum:Sales:qk]' });
  });

  it('resolves a plain field name to its on-shelf token', () => {
    const result = resolveShelfField(WORKSHEET_XML, 'Sales');
    expect(result).toEqual({ ok: true, column: '[Sample - Superstore].[sum:Sales:qk]' });
  });

  it('matches case-insensitively and tolerates surrounding brackets', () => {
    expect(resolveShelfField(WORKSHEET_XML, 'region')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[none:Region:nk]',
    });
    expect(resolveShelfField(WORKSHEET_XML, '[Region]')).toEqual({
      ok: true,
      column: '[Sample - Superstore].[none:Region:nk]',
    });
  });

  it('reports the on-shelf fields when the requested field is absent', () => {
    const result = resolveShelfField(WORKSHEET_XML, 'Discount');
    expect(result).toEqual({
      ok: false,
      reason: 'not_found',
      onShelf: ['[Sample - Superstore].[none:Region:nk]', '[Sample - Superstore].[sum:Sales:qk]'],
    });
  });

  it('reports every distinct canonical candidate when a plain field name is ambiguous', () => {
    expect(resolveShelfField(AMBIGUOUS_WORKSHEET_XML, 'Sales')).toEqual({
      ok: false,
      reason: 'ambiguous',
      candidates: [SALES_SUM, SALES_AVG],
    });
  });

  it.each([SALES_SUM, SALES_AVG])('accepts exact canonical candidate %s', (column) => {
    expect(resolveShelfField(AMBIGUOUS_WORKSHEET_XML, column)).toEqual({ ok: true, column });
  });

  it('does not treat repeated occurrences of one canonical field as ambiguous', () => {
    const duplicateWorksheetXml = WORKSHEET_XML.replace(
      '<rows>[Sample - Superstore].[none:Region:nk]</rows>',
      `<rows>${SALES_SUM}</rows>`,
    );

    expect(resolveShelfField(duplicateWorksheetXml, 'Sales')).toEqual({
      ok: true,
      column: SALES_SUM,
    });
  });
});
