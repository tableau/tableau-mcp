import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { malformedSetGroupfilterRule } from './malformedSetGroupfilter.js';

const rejected = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="Top N Set" field="[Sub-Category]" name="[Set_TopN]" name-style="unqualified" user:ui-domain="relevant">
    <groupfilter count="[Parameters].[Parameter 1]" count-type="count" direction="top" expression="sum" field="[Profit]" function="filter" user:ui-enumeration="inclusive" user:ui-marker="filter-top" />
  </group>
  <group caption="Bottom N Set" field="[Sub-Category]" name="[Set_BottomN]" name-style="unqualified" user:ui-domain="relevant">
    <groupfilter count="[Parameters].[Parameter 1]" count-type="count" direction="bottom" expression="sum" field="[Profit]" function="filter" user:ui-enumeration="inclusive" user:ui-marker="filter-top" />
  </group>
</datasource></datasources></workbook>`;

const safe = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="Top Sub-Category Set" name="[Top Sub-Category Set]" name-style="unqualified">
    <groupfilter count="[Parameters].[Highlight N]" end="top" function="end" units="records">
      <groupfilter direction="DESC" expression="SUM([Profit])" function="order">
        <groupfilter function="level-members" level="[Sub-Category]" />
      </groupfilter>
    </groupfilter>
  </group>
</datasource></datasources></workbook>`;

const vizFilter = `<worksheet name="W"><table><view>
  <filter class="categorical" column="[Sample - Superstore].[none:Region:nk]">
    <groupfilter count="5" function="filter" direction="top" expression="sum" field="[Profit]"/>
  </filter>
</view></table></worksheet>`;

describe('malformed-set-groupfilter rule', () => {
  it('flags both sets using the flat function filter membership', () => {
    const issues = malformedSetGroupfilterRule.validate(rejected);

    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.ruleId === 'malformed-set-groupfilter')).toBe(true);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Set_TopN/);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Set_BottomN/);
    expect(issues[0].suggestion).toMatch(/function='end'/);
    expect(issues[0].suggestion).toMatch(/level-members/);
  });

  it('does not flag the nested end-order-level-members set recipe', () => {
    expect(malformedSetGroupfilterRule.validate(safe)).toHaveLength(0);
  });

  it('does not flag a real viz filter outside a group', () => {
    expect(malformedSetGroupfilterRule.validate(vizFilter)).toHaveLength(0);
  });

  it('does not flag malformed or empty XML', () => {
    expect(malformedSetGroupfilterRule.validate('')).toHaveLength(0);
    expect(malformedSetGroupfilterRule.validate('<not-xml')).toHaveLength(0);
  });

  it('blocks workbook validation when registered', () => {
    const result = runValidation(rejected, 'workbook');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'malformed-set-groupfilter')).toBe(true);
  });
});
