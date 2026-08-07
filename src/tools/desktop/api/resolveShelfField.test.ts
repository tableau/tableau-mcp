import { resolveShelfField } from './resolveShelfField.js';

const WORKSHEET_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sales by Region"><table>' +
  '<rows>[Sample - Superstore].[none:Region:nk]</rows>' +
  '<cols>[Sample - Superstore].[sum:Sales:qk]</cols>' +
  '</table></worksheet>';

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
      onShelf: ['[Sample - Superstore].[none:Region:nk]', '[Sample - Superstore].[sum:Sales:qk]'],
    });
  });
});
