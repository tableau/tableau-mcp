import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { dateFieldBoundAsStringRule } from './dateFieldBoundAsString.js';

function workbook(shelfXml: string, monthDatatype = 'date'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="ds">
      <column caption="Month" datatype="${monthDatatype}" name="[month]" role="dimension" type="nominal" />
      <column caption="Mau" datatype="integer" name="[mau]" role="measure" type="quantitative" />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="MAU">
      <table>
        <view>
          <datasource-dependencies datasource="ds">
            <column caption="Month" datatype="${monthDatatype}" name="[month]" role="dimension" type="nominal" />
            <column-instance column="[month]" derivation="None" name="[none:month:nk]" pivot="key" type="nominal" />
            <column-instance column="[month]" derivation="None" name="[none:month:ok]" pivot="key" type="ordinal" />
            <column-instance column="[month]" derivation="Month" name="[mn:month:ok]" pivot="key" type="ordinal" />
            <column-instance column="[month]" derivation="Month-Trunc" name="[tmn:month:qk]" pivot="key" type="quantitative" />
            <column-instance column="[month]" derivation="Year-Trunc" name="[tyr:month:qk]" pivot="key" type="quantitative" />
            <column caption="Mau" datatype="integer" name="[mau]" role="measure" type="quantitative" />
            <column-instance column="[mau]" derivation="Sum" name="[sum:mau:qk]" pivot="key" type="quantitative" />
          </datasource-dependencies>
        </view>
        ${shelfXml}
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('date-field-bound-as-string rule', () => {
  it('errors on the MAU-line shape: a date metadata field bound as a raw nominal string axis', () => {
    const xml = workbook(`
      <cols>[ds].[none:month:nk]</cols>
      <rows>[ds].[sum:mau:qk]</rows>
    `);

    const issues = dateFieldBoundAsStringRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('date-field-bound-as-string');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('flat categorical axis, not a time axis');
    expect(issues[0].suggestion).toContain('tmn');
  });

  it.each([
    ['discrete month', '[ds].[mn:month:ok]'],
    ['continuous month trunc', '[ds].[tmn:month:qk]'],
    ['year trunc', '[ds].[tyr:month:qk]'],
  ])('stays silent for a proper %s date derivation', (_label, ref) => {
    const xml = workbook(`
      <cols>${ref}</cols>
      <rows>[ds].[sum:mau:qk]</rows>
    `);

    expect(dateFieldBoundAsStringRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a genuinely string Month field with no date metadata', () => {
    const xml = workbook(
      `
      <cols>[ds].[none:month:nk]</cols>
      <rows>[ds].[sum:mau:qk]</rows>
    `,
      'string',
    );

    expect(dateFieldBoundAsStringRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent when a date field is used on filters or encodings instead of rows/cols', () => {
    const xml = workbook(`
      <cols>[ds].[sum:mau:qk]</cols>
      <rows />
      <filter class="categorical" column="[ds].[none:month:nk]" />
      <encodings>
        <color column="[ds].[none:month:nk]" />
      </encodings>
    `);

    expect(dateFieldBoundAsStringRule.validate(xml)).toHaveLength(0);
  });

  it('surfaces through registered validation as an apply-blocking error', () => {
    const result = runValidation(
      workbook(`
        <cols>[ds].[none:month:ok]</cols>
        <rows>[ds].[sum:mau:qk]</rows>
      `),
      'workbook',
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.ruleId === 'date-field-bound-as-string' && issue.severity === 'error',
      ),
    ).toBe(true);
  });
});
