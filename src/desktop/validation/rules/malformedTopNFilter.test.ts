import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { malformedSetGroupfilterRule } from './malformedSetGroupfilter.js';
import { malformedTopNFilterRule } from './malformedTopNFilter.js';

function worksheetWith(filter: string): string {
  return `<worksheet name="S"><table><view>${filter}</view></table></worksheet>`;
}

function workbookWith(filter: string): string {
  return `<workbook><worksheets>${worksheetWith(filter)}</worksheets></workbook>`;
}

const FLAT_TOP_N = `<filter class="categorical" column="[DS].[none:Customer:nk]">
  <groupfilter count="20" count-type="count" direction="top" expression="sum" field="[Sales]" function="filter"/>
</filter>`;

const NESTED_CONFIRMED = `<filter class="categorical" column="[DS].[none:Customer:nk]">
  <groupfilter function="end" end="top" count="20" units="records">
    <groupfilter function="order" direction="DESC" expression="SUM([Sales])">
      <groupfilter function="level-members" level="[none:Customer:nk]"/>
    </groupfilter>
  </groupfilter>
</filter>`;

const EXPRESSION_PREDICATE = `<filter class="categorical" column="[DS].[none:Region:nk]">
  <groupfilter function="filter" expression="SUM([Sales]) &gt; 1000">
    <groupfilter function="level-members" level="[none:Region:nk]"/>
  </groupfilter>
</filter>`;

const FLAT_SET_GROUPFILTER = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="Top N Set" field="[Sub-Category]" name="[Set_TopN]" name-style="unqualified">
    <groupfilter count="[Parameters].[Parameter 1]" count-type="count" direction="top" expression="sum" field="[Profit]" function="filter"/>
  </group>
</datasource></datasources></workbook>`;

describe('malformed-top-n-filter rule', () => {
  it("errors on the flat function='filter' Top-N filter shape", () => {
    const issues = malformedTopNFilterRule.validate(worksheetWith(FLAT_TOP_N));

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('[DS].[none:Customer:nk]');
    expect(issues[0].suggestion).toContain('function="end"');
  });

  it("stays silent on the confirmed nested function='end' recipe", () => {
    expect(malformedTopNFilterRule.validate(worksheetWith(NESTED_CONFIRMED))).toHaveLength(0);
  });

  it("stays silent on a non-Top-N expression predicate using function='filter'", () => {
    expect(malformedTopNFilterRule.validate(worksheetWith(EXPRESSION_PREDICATE))).toHaveLength(0);
  });

  it('does not overlap with malformed-set-groupfilter on set definitions', () => {
    expect(malformedTopNFilterRule.validate(FLAT_SET_GROUPFILTER)).toHaveLength(0);
    expect(malformedSetGroupfilterRule.validate(FLAT_SET_GROUPFILTER)).toHaveLength(1);
  });

  it('blocks worksheet validation when registered', () => {
    const result = runValidation(worksheetWith(FLAT_TOP_N), 'worksheet');

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'malformed-top-n-filter',
          severity: 'error',
        }),
      ]),
    );
  });

  it('blocks workbook validation when registered', () => {
    const result = runValidation(workbookWith(FLAT_TOP_N), 'workbook');

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'malformed-top-n-filter',
          severity: 'error',
        }),
      ]),
    );
  });
});
