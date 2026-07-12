import { describe, expect, it } from 'vitest';

import { computedSortCrashRule } from './computedSortCrash.js';

const CRASHING = `<worksheet name="W"><table><view>
  <sort class="computed-sort" column="[DS].[none:Sub-Category:nk]" direction="DESC">
    <sort-computation direction="DESC" field="[DS].[sum:Profit:qk]"/>
  </sort>
</view></table></worksheet>`;

const NEAR_MISS_COMPUTED = `<worksheet name="W"><table><view>
  <sort class="computed" column="[Sample - Superstore].[none:Sub-Category:nk]" direction="DESC">
    <sort-computation field="[Sample - Superstore].[sum:Profit:qk]"/>
  </sort>
</view></table></worksheet>`;

const SAFE = `<worksheet name="W"><table><view>
  <computed-sort column="[DS].[none:Sub-Category:nk]" direction="DESC" using="[DS].[sum:Profit:qk]"/>
</view></table></worksheet>`;

describe('computed-sort-crash rule', () => {
  it('flags the nested computed-sort sort-computation form', () => {
    const issues = computedSortCrashRule.validate(CRASHING);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].ruleId).toBe('computed-sort-crash');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].suggestion).toMatch(/computed-sort/);
    expect(issues[0].suggestion).toMatch(/using=/);
  });

  it('flags the near-miss computed sort-computation form', () => {
    const issues = computedSortCrashRule.validate(NEAR_MISS_COMPUTED);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].ruleId).toBe('computed-sort-crash');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/undefined field|ignoring sort/);
    expect(issues[0].suggestion).toMatch(/using=/);
  });

  it('flags the computed sort-expression form', () => {
    const sortExpression = `<worksheet name="Profit by Sub-Category"><table><view>
      <sort class="computed" column="[Sample - Superstore].[none:Sub-Category:nk]" direction="DESC">
        <sort-expression><expression op="sum"><expression op="field">
          <expression>[Sample - Superstore].[Profit]</expression>
        </expression></expression></sort-expression>
      </sort>
    </view></table></worksheet>`;
    const issues = computedSortCrashRule.validate(sortExpression);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].ruleId).toBe('computed-sort-crash');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/sort-expression/);
    expect(issues[0].message).toMatch(/undefined field|ignoring sort/);
    expect(issues[0].suggestion).toMatch(/using=/);
  });

  it('does not flag the safe inline computed-sort form', () => {
    expect(computedSortCrashRule.validate(SAFE)).toHaveLength(0);
  });

  it('does not flag a worksheet with no sort', () => {
    expect(computedSortCrashRule.validate('<worksheet name="W"><table><view/></table></worksheet>')).toHaveLength(0);
  });

  it('does not flag a plain manual sort', () => {
    const manual = `<worksheet name="W"><table><view>
      <sort class="manual" column="[DS].[none:Sub-Category:nk]"><dictionary><bucket>&quot;A&quot;</bucket></dictionary></sort>
    </view></table></worksheet>`;
    expect(computedSortCrashRule.validate(manual)).toHaveLength(0);
  });

  it('returns [] on unparseable XML rather than throwing', () => {
    expect(computedSortCrashRule.validate('<not-xml')).toEqual([]);
  });
});
