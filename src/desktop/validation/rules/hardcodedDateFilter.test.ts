import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { hardcodedDateFilterRule } from './hardcodedDateFilter.js';

function filterView(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          ${inner}
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

const hardcodedDateRange = filterView(
  `<filter column="[ds].[none:Order Date:qk]" filter-group="4" class="quantitative" included-values="in-range">
     <min>#2023-01-03#</min>
     <max>#2026-12-30#</max>
   </filter>`,
);

const hardcodedDatetimeRange = filterView(
  `<filter column="[ds].[none:Order Date:qk]" class="quantitative" included-values="in-range">
     <min>#2023-01-03 00:00:00#</min>
     <max>#2026-12-30 23:59:59#</max>
   </filter>`,
);

const numericRange = filterView(
  `<filter column="[ds].[sum:Sales:qk]" class="quantitative" included-values="in-range">
     <min>10</min>
     <max>1000</max>
   </filter>`,
);

const categoricalDateFilter = filterView(
  `<filter column="[ds].[yr:Order Date:ok]" class="categorical">
     <groupfilter function="member" level="[yr:Order Date:ok]" member="2024" />
   </filter>`,
);

describe('hardcoded-date-filter rule', () => {
  it('warns on a fixed start/end date range filter', () => {
    const issues = hardcodedDateFilterRule.validate(hardcodedDateRange);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].ruleId).toBe('hardcoded-date-filter');
    expect(issues[0].message.toLowerCase()).toMatch(/relative|blank|time/);
  });

  it('warns on a fixed datetime range filter', () => {
    const issues = hardcodedDateFilterRule.validate(hardcodedDatetimeRange);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('does not flag a numeric quantitative range filter', () => {
    expect(hardcodedDateFilterRule.validate(numericRange)).toHaveLength(0);
  });

  it('does not flag a categorical date filter', () => {
    expect(hardcodedDateFilterRule.validate(categoricalDateFilter)).toHaveLength(0);
  });

  it('emits nothing on filter-free XML', () => {
    expect(hardcodedDateFilterRule.validate('<workbook><worksheets/></workbook>')).toHaveLength(0);
  });

  it('surfaces as a non-blocking warning', () => {
    const result = runValidation(hardcodedDateRange, 'workbook', [hardcodedDateFilterRule]);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.ruleId === 'hardcoded-date-filter')).toBe(true);
  });
});
