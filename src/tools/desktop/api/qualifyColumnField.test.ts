import { qualifyColumnFields } from './qualifyColumnField.js';

const SINGLE_DS_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sheet 1"><table><view>' +
  '<datasources><datasource name="Sample - Superstore" /></datasources>' +
  '</view></table></worksheet>';

const CAPTIONED_DS_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sheet 1"><table><view>' +
  '<datasources><datasource caption="Sample - Superstore" name="federated.abc" /></datasources>' +
  '</view></table></worksheet>';

const MULTI_DS_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sheet 1"><table><view>' +
  '<datasources><datasource name="Orders" /><datasource name="Returns" /></datasources>' +
  '</view></table></worksheet>';

describe('qualifyColumnFields', () => {
  it('qualifies a bare field name with the single datasource caption', () => {
    expect(qualifyColumnFields(SINGLE_DS_XML, ['Region', 'Sales'])).toEqual({
      ok: true,
      columns: ['[Sample - Superstore].[Region]', '[Sample - Superstore].[Sales]'],
    });
  });

  it('prefers the datasource caption over the internal name', () => {
    expect(qualifyColumnFields(CAPTIONED_DS_XML, ['Region'])).toEqual({
      ok: true,
      columns: ['[Sample - Superstore].[Region]'],
    });
  });

  it('passes an already-qualified value through verbatim', () => {
    expect(qualifyColumnFields(SINGLE_DS_XML, ['[Other DS].[Profit]'])).toEqual({
      ok: true,
      columns: ['[Other DS].[Profit]'],
    });
  });

  it('tolerates a bracketed bare name', () => {
    expect(qualifyColumnFields(SINGLE_DS_XML, ['[Region]'])).toEqual({
      ok: true,
      columns: ['[Sample - Superstore].[Region]'],
    });
  });

  it('refuses a bare name when the worksheet has multiple datasources', () => {
    const result = qualifyColumnFields(MULTI_DS_XML, ['Region']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('multiple datasources');
    }
  });
});
