import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { calcFieldNamesRule } from './calcFieldNames.js';

const RETAINED_HISTOGRAM_WORKSHEET_XML = `<worksheet name='Create a histogram chart of Revenue.' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <table>
    <view>
      <datasources>
        <datasource caption='h6-gross-margin-calc' name='federated.csv040059ff380b040059ff380b' />
      </datasources>
      <datasource-dependencies datasource='federated.csv040059ff380b040059ff380b'>
        <column aggregation='None' caption='revenue' datatype='integer' name='[Profit (bin)_tpl_12e12d4d]' role='dimension' type='ordinal'>
          <calculation class='bin' decimals='2' formula='[revenue]' peg='0' size='500' />
        </column>
        <column-instance column='[revenue]' derivation='Count' name='[cnt:revenue:qk]' pivot='key' type='quantitative' />
        <column-instance column='[Profit (bin)_tpl_12e12d4d]' derivation='None' name='[none:Profit (bin)_tpl_12e12d4d:qk]' pivot='key' type='quantitative' />
        <column caption='Revenue' datatype='integer' name='[revenue]' role='measure' type='quantitative' />
      </datasource-dependencies>
      <aggregation value='true' />
    </view>
    <style />
    <panes>
      <pane selection-relaxation-option='selection-relaxation-allow'>
        <view>
          <breakdown value='auto' />
        </view>
        <mark class='Bar' />
        <mark-sizing custom-mark-size-in-axis-units='1.0' mark-alignment='mark-alignment-left' mark-sizing-setting='marks-scaling-on' use-custom-mark-size='false' />
      </pane>
    </panes>
    <rows>[federated.csv040059ff380b040059ff380b].[cnt:revenue:qk]</rows>
    <cols>[federated.csv040059ff380b040059ff380b].[none:Profit (bin)_tpl_12e12d4d:qk]</cols>
    <show-full-range>
      <column>[federated.csv040059ff380b040059ff380b].[none:Profit (bin)_tpl_12e12d4d:qk]</column>
    </show-full-range>
  </table>
  <simple-id uuid='{8C2294E5-4AA0-4DCA-992E-790D6F5B661D}' />
</worksheet>
`;

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

describe('calc-field-names native bin boundary', () => {
  it('ignores the exact retained fixed-width bin name after structural readback', () => {
    expect(
      createHash('sha256').update(RETAINED_HISTOGRAM_WORKSHEET_XML, 'utf8').digest('hex'),
    ).toBe('9de874ea076b2dc4fab6cb075403190ccb2707dad18a5a99040f02f2fec166fe');
    expect(calcFieldNamesRule.validate(RETAINED_HISTOGRAM_WORKSHEET_XML)).toEqual([]);
  });

  it.each([
    ['regular calculation', "class='tableau'"],
    ['zero width', "size='0'"],
    ['negative width', "size='-500'"],
    ['nonfinite width', "size='Infinity'"],
    ['nonfinite peg', "peg='NaN'"],
    ['hex width', "size='0x10'"],
    ['binary width', "size='0b10'"],
    ['hex peg', "peg='0x10'"],
    ['binary peg', "peg='0b10'"],
    ['missing peg', ''],
    ['missing size', ''],
    ['blank formula', "formula=''"],
  ])('keeps the naming warning for %s', (label, replacement) => {
    let xml = RETAINED_HISTOGRAM_WORKSHEET_XML;
    if (label === 'missing peg') xml = xml.replace(" peg='0'", '');
    else if (label === 'missing size') xml = xml.replace(" size='500'", '');
    else if (label === 'blank formula') xml = xml.replace("formula='[revenue]'", replacement);
    else if (label === 'regular calculation') xml = xml.replace("class='bin'", replacement);
    else if (label === 'nonfinite peg') xml = xml.replace("peg='0'", replacement);
    else if (label === 'hex peg' || label === 'binary peg') {
      xml = xml.replace("peg='0'", replacement);
    } else xml = xml.replace("size='500'", replacement);
    expect(calcFieldNamesRule.validate(xml), label).toEqual([
      expect.objectContaining({ ruleId: 'calc-field-names', severity: 'warning' }),
    ]);
  });

  it('keeps a warning when a bin column also has a second calculation', () => {
    const xml = RETAINED_HISTOGRAM_WORKSHEET_XML.replace(
      "<calculation class='bin' decimals='2' formula='[revenue]' peg='0' size='500' />",
      "<calculation class='bin' decimals='2' formula='[revenue]' peg='0' size='500' /><calculation class='tableau' formula='1' />",
    );
    expect(calcFieldNamesRule.validate(xml)).toEqual([
      expect.objectContaining({ ruleId: 'calc-field-names', severity: 'warning' }),
    ]);
  });

  it.each([
    ['missing field', '[Definitely Missing]'],
    ['self reference', '[Profit (bin)_tpl_12e12d4d]'],
    ['compound formula', '[revenue] + 1'],
  ])('keeps a warning for a native bin with a %s', (_label, formula) => {
    const xml = RETAINED_HISTOGRAM_WORKSHEET_XML.replace(
      "formula='[revenue]'",
      `formula='${formula}'`,
    );
    expect(calcFieldNamesRule.validate(xml)).toEqual([
      expect.objectContaining({ ruleId: 'calc-field-names', severity: 'warning' }),
    ]);
  });

  it('keeps a warning when the referenced sibling field is duplicated', () => {
    const xml = RETAINED_HISTOGRAM_WORKSHEET_XML.replace(
      '</datasource-dependencies>',
      "<column caption='Revenue duplicate' datatype='integer' name='[revenue]' role='measure' type='quantitative' /></datasource-dependencies>",
    );
    expect(calcFieldNamesRule.validate(xml)).toEqual([
      expect.objectContaining({ ruleId: 'calc-field-names', severity: 'warning' }),
    ]);
  });

  it('keeps a warning when the referenced field exists only in another dependency scope', () => {
    const revenueColumn =
      "<column caption='Revenue' datatype='integer' name='[revenue]' role='measure' type='quantitative' />";
    const xml = RETAINED_HISTOGRAM_WORKSHEET_XML.replace(revenueColumn, '').replace(
      '</view>',
      `<datasource-dependencies datasource='Other'>${revenueColumn}</datasource-dependencies></view>`,
    );
    expect(calcFieldNamesRule.validate(xml)).toEqual([
      expect.objectContaining({ ruleId: 'calc-field-names', severity: 'warning' }),
    ]);
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
