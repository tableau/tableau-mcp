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

// The valid NESTED condition (rule-based) set: a function='filter' groupfilter that
// WRAPS a level-members child. Verified byte-for-byte against a live Desktop readback.
// The old substring detector false-positived on this; it must NOT be flagged.
const conditionSet = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="High Sales Cities" name="[High Sales Cities]" name-style="unqualified" user:ui-builder="filter-group">
    <groupfilter expression="SUM([Sales])&gt;=60000" function="filter" user:ui-filter-by-field="true" user:ui-marker="filter-by">
      <groupfilter function="level-members" level="[City]" user:ui-enumeration="all" user:ui-marker="enumerate" />
    </groupfilter>
  </group>
</datasource></datasources></workbook>`;

// A childless function='filter' set written with an explicit close instead of self-closing.
// Still flat (zero nested children) => Tableau deletes it => must still be flagged.
const emptyCloseFilter = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="Broken Set" name="[Broken Set]" name-style="unqualified">
    <groupfilter function="filter" expression="SUM([Sales])&gt;=60000"></groupfilter>
  </group>
</datasource></datasources></workbook>`;

// Flat/broken condition sets whose expression attribute comes FIRST and carries an UNESCAPED '>'
// (legal XML inside a quoted value). A naive [^>]* tag scan stops at that '>' and misses the tag,
// letting this childless function='filter' set reach Desktop and be silently deleted. The
// quote-aware detector must still flag both the self-closing and explicit-close forms.
const flatExprFirstUnescaped = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="Broken" name="[Broken]" name-style="unqualified">
    <groupfilter expression="SUM([Sales])>=60000" function="filter" />
  </group>
</datasource></datasources></workbook>`;
const flatExprFirstUnescapedEmptyClose = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="Broken" name="[Broken]" name-style="unqualified">
    <groupfilter expression="SUM([Sales])>=60000" function="filter"></groupfilter>
  </group>
</datasource></datasources></workbook>`;

// A VALID nested condition set with an XML comment between the outer function='filter' tag and its
// level-members child. The child IS present, so it must NOT be flagged (comments are skipped).
const conditionSetWithComment = `<workbook><datasources><datasource name="Sample - Superstore">
  <group caption="High Sales Cities" name="[High Sales Cities]" name-style="unqualified" user:ui-builder="filter-group">
    <groupfilter expression="SUM([Sales])&gt;=60000" function="filter" user:ui-filter-by-field="true" user:ui-marker="filter-by"><!-- membership rule -->
      <groupfilter function="level-members" level="[City]" user:ui-enumeration="all" user:ui-marker="enumerate" />
    </groupfilter>
  </group>
</datasource></datasources></workbook>`;

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

  it('does not flag a valid nested condition (filter) set — the false-positive regression', () => {
    expect(malformedSetGroupfilterRule.validate(conditionSet)).toHaveLength(0);
  });

  it('still flags a childless function=filter set written with an explicit close tag', () => {
    const issues = malformedSetGroupfilterRule.validate(emptyCloseFilter);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('malformed-set-groupfilter');
    expect(issues[0].message).toMatch(/Broken Set/);
  });

  it('flags a flat function=filter set even when expression-first with an unescaped ">"', () => {
    // Quote-aware scan: the '>' inside expression="…>…" must not end the tag early.
    expect(malformedSetGroupfilterRule.validate(flatExprFirstUnescaped)).toHaveLength(1);
    expect(malformedSetGroupfilterRule.validate(flatExprFirstUnescapedEmptyClose)).toHaveLength(1);
  });

  it('does not flag a valid nested condition set with a comment between the filter tag and its child', () => {
    expect(malformedSetGroupfilterRule.validate(conditionSetWithComment)).toHaveLength(0);
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
