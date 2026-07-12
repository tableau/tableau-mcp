import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import {
  categoricalFilterSlicesRule,
  normalizeFilterColumnForSlices,
} from './categoricalFilterSlices.js';

function workbook(filterColumn: string, sliceColumn?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <filter class="categorical" column="${filterColumn}">
            <groupfilter function="member" member="Central" />
          </filter>
          ${sliceColumn ? `<slices><column column="${sliceColumn}" /></slices>` : ''}
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

function workbookWithTextSlice(filterColumn: string, sliceColumn: string): string {
  return workbook(filterColumn).replace(
    '</view>',
    `<slices><column>${sliceColumn}</column></slices></view>`,
  );
}

describe('categorical-filter-slices rule', () => {
  it.each([
    ['raw field', '[ds].[[Region]]', '[ds].[[Region]]'],
    ['column instance', '[ds].[none:Region:nk]', '[ds].[[Region]]'],
    ['date derivation', '[ds].[tmn:Order Date:ok]', '[ds].[[Order Date]]'],
    ['Measure Names', '[ds].[:Measure Names]', '[ds].[:Measure Names]'],
    ['Top-N-like categorical', '[ds].[none:Artist:nk]', '[ds].[[Artist]]'],
  ])(
    'emits no warning when %s categorical filter has a matching slice',
    (_label, filterColumn, sliceColumn) => {
      expect(
        categoricalFilterSlicesRule.validate(workbook(filterColumn, sliceColumn)),
      ).toHaveLength(0);
    },
  );

  it('emits a non-blocking warning when a categorical filter has no matching slice', () => {
    const issues = categoricalFilterSlicesRule.validate(workbook('[ds].[none:Region:nk]'));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('may silently strip');
  });

  it('recognizes Tableau-style slices where the column reference is element text', () => {
    const issues = categoricalFilterSlicesRule.validate(
      workbookWithTextSlice('[ds].[none:Region:nk]', '[ds].[none:Region:nk]'),
    );
    expect(issues).toHaveLength(0);
  });

  it('does not make registry validation invalid because this is a warning', () => {
    const result = runValidation(workbook('[ds].[none:Region:nk]'), 'workbook', [
      categoricalFilterSlicesRule,
    ]);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.ruleId === 'categorical-filter-slices')).toBe(true);
  });

  it('normalizes the supported filter column forms to comparable local names', () => {
    expect(normalizeFilterColumnForSlices('[ds].[none:Region:nk]')).toBe('region');
    expect(normalizeFilterColumnForSlices('[ds].[[Region]]')).toBe('region');
    expect(normalizeFilterColumnForSlices('[ds].[tmn:Order Date:ok]')).toBe('order date');
    expect(normalizeFilterColumnForSlices('[ds].[:Measure Names]')).toBe('measure names');
  });
});

function quantWorkbook(filterColumn: string, sliceColumn?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <filter column="${filterColumn}" class="quantitative" included-values="in-range">
            <max>10</max>
          </filter>
          ${sliceColumn ? `<slices><column>${sliceColumn}</column></slices>` : ''}
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('categorical-filter-slices rule quantitative table-calc extension', () => {
  it('warns when a table-calc quantitative filter has no matching slice', () => {
    const issues = categoricalFilterSlicesRule.validate(
      quantWorkbook('[ds].[usr:Calculation_Rank:qk]'),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message.toLowerCase()).toContain('slices');
  });

  it('emits nothing when the table-calc quantitative filter has a matching slice', () => {
    const issues = categoricalFilterSlicesRule.validate(
      quantWorkbook('[ds].[usr:Calculation_Rank:qk]', '[ds].[usr:Calculation_Rank:qk]'),
    );
    expect(issues).toHaveLength(0);
  });

  it('does not fire on a plain measure quantitative filter', () => {
    expect(categoricalFilterSlicesRule.validate(quantWorkbook('[ds].[sum:Sales:qk]'))).toHaveLength(
      0,
    );
  });
});
