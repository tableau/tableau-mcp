import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { dateLikeStringOnTimeAxisRule } from './dateLikeStringOnTimeAxis.js';

const DS = 'federated.1vwr59x1oco9q01gp1gt11f4ntnv';
const MONTH = `[${DS}].[none:month:nk]`;
const MONTH_DATE_CALC = `[${DS}].[none:Month Date:nk]`;
const MONTH_TRUNC = `[${DS}].[tmn:month:qk]`;
const PRODUCT = `[${DS}].[none:product:nk]`;
const MAU = `[${DS}].[sum:mau:qk]`;

function anchoredWorksheet({
  mark = 'Line',
  cols = MONTH,
  rows = MAU,
  encodings = '',
}: {
  mark?: string;
  cols?: string;
  rows?: string;
  encodings?: string;
} = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="${DS}">
      <column caption="Month" datatype="string" name="[month]" role="dimension" type="nominal" />
      <column caption="Product" datatype="string" name="[product]" role="dimension" type="nominal" />
      <column caption="Mau" datatype="integer" name="[mau]" role="measure" type="quantitative" />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="MAU">
      <table>
        <view>
          <datasource-dependencies datasource="${DS}">
            <column caption="Month" datatype="string" name="[month]" role="dimension" type="nominal" />
            <column caption="Product" datatype="string" name="[product]" role="dimension" type="nominal" />
            <column caption="Mau" datatype="integer" name="[mau]" role="measure" type="quantitative" />
            <column-instance column="[month]" derivation="None" name="[none:month:nk]" pivot="key" type="nominal" />
            <column-instance column="[Month Date]" derivation="None" name="[none:Month Date:nk]" pivot="key" type="nominal" />
            <column-instance column="[month]" derivation="Month-Trunc" name="[tmn:month:qk]" pivot="key" type="quantitative" />
            <column-instance column="[product]" derivation="None" name="[none:product:nk]" pivot="key" type="nominal" />
            <column-instance column="[mau]" derivation="Sum" name="[sum:mau:qk]" pivot="key" type="quantitative" />
          </datasource-dependencies>
        </view>
        <panes>
          <pane>
            <mark class="${mark}" />
            ${encodings}
          </pane>
        </panes>
        <rows>${rows}</rows>
        <cols>${cols}</cols>
      </table>
    </worksheet>
  </worksheets>
  <windows>
    <window class="worksheet" name="MAU"><cards /></window>
  </windows>
</workbook>`;
}

function withDateParseCalc(xml: string): string {
  return xml.replace(
    '<column caption="Month" datatype="string" name="[month]" role="dimension" type="nominal" />',
    '<column caption="Month" datatype="string" name="[month]" role="dimension" type="nominal" />' +
      '<column caption="Month Date" datatype="date" name="[Month Date]" role="dimension" type="ordinal">' +
      '<calculation class="tableau" formula="DATE([month])" />' +
      '</column>',
  );
}

describe('date-like-string-on-time-axis rule', () => {
  it('WARNs on the MAU line shape: string month on cols with a continuous measure on rows', () => {
    const issues = dateLikeStringOnTimeAxisRule.validate(anchoredWorksheet());

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('date-like-string-on-time-axis');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toMatch(/flat categorical labels/i);
    expect(issues[0].message).toMatch(/time axis/i);
    expect(issues[0].suggestion).toMatch(/DATE\(\[Month\]\)|categorical intent/i);
  });

  it('stays silent when a DATE() parse calc supplies a date-typed field', () => {
    const xml = withDateParseCalc(anchoredWorksheet({ cols: MONTH_DATE_CALC }));
    expect(dateLikeStringOnTimeAxisRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent when the pill uses a proper date derivation', () => {
    expect(
      dateLikeStringOnTimeAxisRule.validate(anchoredWorksheet({ cols: MONTH_TRUNC })),
    ).toHaveLength(0);
  });

  it('stays silent for a bar chart where Month is clearly categorical', () => {
    const xml = anchoredWorksheet({
      mark: 'Bar',
      encodings: `<encodings><color column="${MONTH}" /></encodings>`,
    });

    expect(dateLikeStringOnTimeAxisRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent for a non-date-like string field on a line chart', () => {
    expect(
      dateLikeStringOnTimeAxisRule.validate(anchoredWorksheet({ cols: PRODUCT })),
    ).toHaveLength(0);
  });

  it('stays silent when the date-like string pill appears without time-series intent', () => {
    expect(
      dateLikeStringOnTimeAxisRule.validate(anchoredWorksheet({ mark: 'Automatic', rows: '' })),
    ).toHaveLength(0);
  });

  it('surfaces as a non-blocking warning through registered validation', () => {
    const result = runValidation(anchoredWorksheet(), 'workbook');

    expect(result.valid).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.ruleId === 'date-like-string-on-time-axis' && issue.severity === 'warning',
      ),
    ).toBe(true);
  });
});
