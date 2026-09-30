import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { calcFieldNamesRule } from './calcFieldNames.js';

describe('calc-field-names rule', () => {
  it('valid [Calculation_123] passes with no issues', () => {
    const xml = buildWorkbookXmlWithCalc('[Calculation_123]');
    const issues = calcFieldNamesRule.validate(xml);
    expect(issues.length).toBe(0);
  });

  it('valid [Calculation_20260414_001] passes with no issues', () => {
    const xml = buildWorkbookXmlWithCalc('[Calculation_20260414_001]');
    const issues = calcFieldNamesRule.validate(xml);
    expect(issues.length).toBe(0);
  });

  it('invalid [R Score] at datasource level produces warning', () => {
    const xml = buildWorkbookXmlWithCalc('[R Score]');
    const issues = calcFieldNamesRule.validate(xml);
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('invalid [My Calc] at datasource level produces warning', () => {
    const xml = buildWorkbookXmlWithCalc('[My Calc]');
    const issues = calcFieldNamesRule.validate(xml);
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('inline [Calc_ContentType] in datasource-dependencies produces warning only', () => {
    const xml = buildWorksheetXmlWithCalc('[Calc_ContentType]');
    const issues = calcFieldNamesRule.validate(xml);
    expect(issues.filter((i) => i.severity === 'error').length).toBe(0);
    expect(issues.filter((i) => i.severity === 'warning').length).toBeGreaterThan(0);
  });

  it('column without calculation child is not flagged', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <column name="[Sales]" role="measure" type="quantitative" datatype="real" />
    </datasource>
  </datasources>
</workbook>`;
    const issues = calcFieldNamesRule.validate(xml);
    expect(issues.length).toBe(0);
  });

  it('warning issue includes suggestion with [Calculation_*] format', () => {
    const xml = buildWorkbookXmlWithCalc('[Bad Name]');
    const issues = calcFieldNamesRule.validate(xml);
    const warning = issues.find((i) => i.severity === 'warning');
    expect(warning).toBeDefined();
    expect(warning!.suggestion?.includes('[Calculation_')).toBe(true);
  });
});

describe('calc-field-names rule — false-positive guards', () => {
  it('parameter columns do not block validation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="Parameters">
      <column name="[Parameter 1]" role="measure" type="quantitative" datatype="real"
              caption="My Param" param-domain-type="list">
        <calculation class="tableau" formula="1" />
      </column>
    </datasource>
  </datasources>
</workbook>`;
    const result = runValidation(xml, 'workbook', [calcFieldNamesRule]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('bin columns do not block validation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <column name="[Profit (bin)]" role="dimension" type="ordinal" datatype="integer"
              caption="Profit (bin)">
        <calculation class="bin" formula="[Profit]" bins-count="10" />
      </column>
    </datasource>
  </datasources>
</workbook>`;
    const result = runValidation(xml, 'workbook', [calcFieldNamesRule]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('copy-pattern columns do not block validation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <column name="[Foo (copy)_123456789]" role="measure" type="quantitative" datatype="real"
              caption="Foo (copy)">
        <calculation class="tableau" formula="[Foo]" />
      </column>
    </datasource>
  </datasources>
</workbook>`;
    const result = runValidation(xml, 'workbook', [calcFieldNamesRule]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('auto-columns do not block validation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <column name="[Number of Records]" role="measure" type="quantitative" datatype="integer"
              caption="Number of Records">
        <calculation class="tableau" formula="1" />
      </column>
    </datasource>
  </datasources>
</workbook>`;
    const result = runValidation(xml, 'workbook', [calcFieldNamesRule]);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe('warning');
  });
});

function buildWorkbookXmlWithCalc(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="my-data">
      <column name="${name}" role="measure" type="quantitative" datatype="real" caption="My Field">
        <calculation formula="SUM([Sales])" class="tableau" />
      </column>
    </datasource>
  </datasources>
</workbook>`;
}

function buildWorksheetXmlWithCalc(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet name="Sheet 1">
  <datasources>
    <datasource name="my-data" />
  </datasources>
  <view>
    <datasources>
      <datasource name="my-data" />
    </datasources>
    <datasource-dependencies datasource="my-data">
      <column name="${name}" role="dimension" type="nominal" datatype="string" caption="Content Type">
        <calculation formula="IF [a] THEN 'X' ELSE 'Y' END" class="tableau" />
      </column>
    </datasource-dependencies>
  </view>
</worksheet>`;
}
