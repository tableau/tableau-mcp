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

const MULTI_CAPTIONED_DS_XML =
  '<?xml version="1.0"?>' +
  '<worksheet name="Sheet 1"><table><view>' +
  '<datasources>' +
  '<datasource caption="Sample - Superstore" name="federated.abc" />' +
  '<datasource caption="Returns" name="federated.def" />' +
  '</datasources>' +
  '</view></table></worksheet>';

describe('qualifyColumnFields', () => {
  it('qualifies a bare field name with the datasource internal name on API 0.2.25 and later', () => {
    expect(qualifyColumnFields(SINGLE_DS_XML, ['Region', 'Sales'], '0.2.25')).toEqual({
      ok: true,
      columns: ['[Sample - Superstore].[Region]', '[Sample - Superstore].[Sales]'],
    });
    expect(qualifyColumnFields(CAPTIONED_DS_XML, ['Region'], '0.2.25')).toEqual({
      ok: true,
      columns: ['[federated.abc].[Region]'],
    });
  });

  it('qualifies with the datasource caption on earlier API versions', () => {
    expect(qualifyColumnFields(CAPTIONED_DS_XML, ['Region'], '0.2.24')).toEqual({
      ok: true,
      columns: ['[Sample - Superstore].[Region]'],
    });
  });

  it('qualifies with the datasource caption when the API version is unknown', () => {
    expect(qualifyColumnFields(CAPTIONED_DS_XML, ['Region'], undefined)).toEqual({
      ok: true,
      columns: ['[Sample - Superstore].[Region]'],
    });
  });

  it('passes an already-qualified value through verbatim', () => {
    expect(qualifyColumnFields(SINGLE_DS_XML, ['[Other DS].[Profit]'], '0.2.25')).toEqual({
      ok: true,
      columns: ['[Other DS].[Profit]'],
    });
  });

  it('tolerates a bracketed bare name', () => {
    expect(qualifyColumnFields(CAPTIONED_DS_XML, ['[Region]'], '0.2.25')).toEqual({
      ok: true,
      columns: ['[federated.abc].[Region]'],
    });
  });

  it('refuses a bare name when the worksheet has multiple datasources', () => {
    const result = qualifyColumnFields(MULTI_DS_XML, ['Region'], '0.2.25');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('multiple datasources');
    }
  });

  it('lists the internal-name values to pass when a bare name is ambiguous on API 0.2.25 and later', () => {
    expect(qualifyColumnFields(MULTI_CAPTIONED_DS_XML, ['Region'], '0.2.25')).toEqual({
      ok: false,
      reason:
        'the worksheet uses multiple datasources, so "Region" is ambiguous — ' +
        'pass one of: [federated.abc].[Region], [federated.def].[Region]',
    });
  });

  it('lists the caption values to pass when a bare name is ambiguous on earlier API versions', () => {
    expect(qualifyColumnFields(MULTI_CAPTIONED_DS_XML, ['[Region]'], '0.2.24')).toEqual({
      ok: false,
      reason:
        'the worksheet uses multiple datasources, so "[Region]" is ambiguous — ' +
        'pass one of: [Sample - Superstore].[Region], [Returns].[Region]',
    });
  });

  it('refuses a bare name when the worksheet declares no datasource', () => {
    const result = qualifyColumnFields(
      '<?xml version="1.0"?><worksheet name="Sheet 1"><table><view /></table></worksheet>',
      ['Region'],
      '0.2.25',
    );
    expect(result).toEqual({
      ok: false,
      reason: 'the worksheet declares no datasource to qualify the field name against',
    });
  });
});
