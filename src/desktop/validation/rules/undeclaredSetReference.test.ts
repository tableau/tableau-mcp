import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { undeclaredSetReferenceRule } from './undeclaredSetReference.js';

const rejected = `<workbook>
  <datasources>
    <datasource name="Sample - Superstore">
      <column caption="Profit Group" datatype="string" name="[Calculation_1719878400001]" role="dimension" type="nominal">
        <calculation class="tableau" formula="IF [Set_Top_Performers] THEN &quot;Top&quot; ELSEIF [Set_Bottom_Performers] THEN &quot;Bottom&quot; ELSE &quot;Middle&quot; END"/>
      </column>
    </datasource>
  </datasources>
</workbook>`;

const safeDefined = `<workbook>
  <datasources>
    <datasource name="Sample - Superstore">
      <group caption="Top Sub-Category Set" name="[Top Sub-Category Set]" name-style="unqualified">
        <groupfilter count="[Parameters].[Highlight N]" end="top" function="end" units="records">
          <groupfilter direction="DESC" expression="SUM([Profit])" function="order">
            <groupfilter function="level-members" level="[Sub-Category]"/>
          </groupfilter>
        </groupfilter>
      </group>
      <group caption="Bottom Sub-Category Set" name="[Bottom Sub-Category Set]" name-style="unqualified">
        <groupfilter count="[Parameters].[Highlight N]" end="bottom" function="end" units="records">
          <groupfilter direction="ASC" expression="SUM([Profit])" function="order">
            <groupfilter function="level-members" level="[Sub-Category]"/>
          </groupfilter>
        </groupfilter>
      </group>
      <column caption="Profit Group" datatype="string" name="[Calculation_1]" role="dimension" type="nominal">
        <calculation class="tableau" formula="IF [Top Sub-Category Set] THEN &quot;Top&quot; ELSEIF [Bottom Sub-Category Set] THEN &quot;Bottom&quot; ELSE &quot;Middle&quot; END"/>
      </column>
    </datasource>
  </datasources>
</workbook>`;

describe('undeclared-set-reference rule', () => {
  it('flags both undefined sets referenced by a calc', () => {
    const issues = undeclaredSetReferenceRule.validate(rejected);

    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.ruleId === 'undeclared-set-reference')).toBe(true);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Set_Top_Performers/);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Set_Bottom_Performers/);
    expect(issues[0].suggestion).toMatch(/<group/);
    expect(issues[0].suggestion).toMatch(/groupfilter/);
  });

  it('does not flag sets declared as groups', () => {
    expect(undeclaredSetReferenceRule.validate(safeDefined)).toHaveLength(0);
  });

  it('flags an undefined set with Tableau default hyphenated naming', () => {
    const xml = `<workbook><datasources><datasource name="Sample - Superstore">
      <column name="[C]"><calculation class="tableau" formula="IF [Top Sub-Category Set] THEN &quot;Top&quot; ELSE &quot;Other&quot; END"/></column>
    </datasource></datasources></workbook>`;

    const issues = undeclaredSetReferenceRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Top Sub-Category Set/);
  });

  it('does not flag the same hyphenated set once it is declared as a group', () => {
    const xml = `<workbook><datasources><datasource name="Sample - Superstore">
      <group caption="Top Sub-Category Set" name="[Top Sub-Category Set]" name-style="unqualified">
        <groupfilter count="[Parameters].[N]" end="top" function="end" units="records"/>
      </group>
      <column name="[C]"><calculation class="tableau" formula="IF [Top Sub-Category Set] THEN &quot;Top&quot; ELSE &quot;Other&quot; END"/></column>
    </datasource></datasources></workbook>`;

    expect(undeclaredSetReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag when there are no calc formulas', () => {
    const xml =
      '<workbook><datasources><datasource name="X"><column name="[Profit]" role="measure"/></datasource></datasources></workbook>';

    expect(undeclaredSetReferenceRule.validate(xml)).toHaveLength(0);
  });

  it("does not flag a real field merely named with 'Set' when it has a column declaration", () => {
    const xml = `<workbook><datasources><datasource name="X">
      <column caption="Data Set" datatype="string" name="[Data Set]" role="dimension" type="nominal"/>
      <column name="[C1]"><calculation class="tableau" formula="IF ISNULL([Data Set]) THEN &quot;n&quot; ELSE &quot;y&quot; END"/></column>
    </datasource></datasources></workbook>`;

    expect(undeclaredSetReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a set name that appears only inside a string literal', () => {
    const xml = `<workbook><datasources><datasource name="Sample - Superstore">
      <column name="[C]"><calculation class="tableau" formula="IF [Profit] &gt; 0 THEN &quot;[Top Sub-Category Set]&quot; ELSE &quot;Other&quot; END"/></column>
    </datasource></datasources></workbook>`;

    expect(undeclaredSetReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('still flags a bracketed set reference outside any string literal', () => {
    const xml = `<workbook><datasources><datasource name="Sample - Superstore">
      <column name="[C]"><calculation class="tableau" formula="IF [Top Sub-Category Set] THEN &quot;yes&quot; ELSE &quot;no&quot; END"/></column>
    </datasource></datasources></workbook>`;

    const issues = undeclaredSetReferenceRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Top Sub-Category Set/);
  });

  it('does not flag malformed or empty XML', () => {
    expect(undeclaredSetReferenceRule.validate('')).toHaveLength(0);
    expect(undeclaredSetReferenceRule.validate('<not-xml')).toHaveLength(0);
  });

  it('blocks workbook validation but not worksheet validation when registered', () => {
    expect(runValidation(rejected, 'workbook').valid).toBe(false);
    expect(
      runValidation(rejected, 'worksheet').issues.some(
        (i) => i.ruleId === 'undeclared-set-reference',
      ),
    ).toBe(false);
  });
});
