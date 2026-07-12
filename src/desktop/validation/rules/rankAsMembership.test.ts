import { describe, expect, it } from 'vitest';

import { rankAsMembershipRule } from './rankAsMembership.js';

const wb = (formula: string) =>
  `<workbook><datasources><datasource name="ds"><column name="[C]"><calculation class="tableau" formula='${formula}'/></column></datasource></datasources></workbook>`;

describe('rank-as-membership rule', () => {
  it('flags RANK compared to a parameter, branching to string labels', () => {
    const issues = rankAsMembershipRule.validate(
      wb(
        'IF RANK(SUM([Profit])) &lt;= [Parameters].[TopN] THEN &quot;Top&quot; ELSEIF RANK(SUM([Profit])) &gt; SIZE() - [Parameters].[TopN] THEN &quot;Bottom&quot; ELSE &quot;Everyone Else&quot; END',
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rank-as-membership');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].suggestion).toMatch(/LOD membership tier calc|lod-membership-tier-calc/);
  });

  it('flags the single-quote and integer-threshold variant too', () => {
    const issues = rankAsMembershipRule.validate(
      wb('IF RANK(SUM([Sales])) <= 5 THEN "Top 5" ELSE "Rest" END'),
    );
    expect(issues).toHaveLength(1);
  });

  it('flags the INDEX() twin', () => {
    const issues = rankAsMembershipRule.validate(
      wb(
        'IF INDEX() &lt;= [Parameters].[N] THEN &quot;Top&quot; ELSEIF INDEX() &gt; SIZE() - [Parameters].[N] THEN &quot;Bottom&quot; ELSE &quot;Middle&quot; END',
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('rank-as-membership');
    expect(issues[0].message).toMatch(/INDEX|POSITIONAL TABLE CALC/);
  });

  it('flags the FIRST()/LAST() membership variants', () => {
    expect(
      rankAsMembershipRule.validate(wb('IF FIRST() <= [Parameters].[N] THEN "Top" ELSE "Rest" END')),
    ).toHaveLength(1);
    expect(
      rankAsMembershipRule.validate(wb('IF LAST() <= [Parameters].[N] THEN "Bottom" ELSE "Rest" END')),
    ).toHaveLength(1);
  });

  it('flags the INDEX() split form', () => {
    const split = `<workbook><datasources><datasource name="ds">
      <column name="[Pos]"><calculation class="tableau" formula="INDEX()"/></column>
      <column name="[Label]"><calculation class="tableau" formula='IF [Pos] &lt;= [Parameters].[N] THEN &quot;Top&quot; ELSE &quot;Rest&quot; END'/></column>
    </datasource></datasources></workbook>`;
    expect(rankAsMembershipRule.validate(split).length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag a legit INDEX() top-N filter with no string-label branch', () => {
    expect(rankAsMembershipRule.validate(wb('INDEX() <= [Parameters].[TopN]'))).toHaveLength(0);
  });

  it('does not flag a bare INDEX() displayed as a value', () => {
    expect(rankAsMembershipRule.validate(wb('INDEX()'))).toHaveLength(0);
  });

  it('flags the RANK split form', () => {
    const split = `<workbook><datasources><datasource name="ds">
      <column name="[RankCalc]"><calculation class="tableau" formula="RANK(SUM([Profit]))"/></column>
      <column name="[Label]"><calculation class="tableau" formula='IF [RankCalc] &lt;= [Parameters].[N] THEN &quot;Top&quot; ELSE &quot;Rest&quot; END'/></column>
    </datasource></datasources></workbook>`;
    const issues = rankAsMembershipRule.validate(split);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].ruleId).toBe('rank-as-membership');
  });

  it('does not flag split form when the referenced calc is not a rank', () => {
    const split = `<workbook><datasources><datasource name="ds">
      <column name="[ProfitCalc]"><calculation class="tableau" formula="SUM([Profit])"/></column>
      <column name="[Label]"><calculation class="tableau" formula='IF [ProfitCalc] &gt;= 10000 THEN &quot;High&quot; ELSE &quot;Low&quot; END'/></column>
    </datasource></datasources></workbook>`;
    expect(rankAsMembershipRule.validate(split)).toHaveLength(0);
  });

  it('does not flag a bare RANK displayed as a value', () => {
    expect(rankAsMembershipRule.validate(wb('RANK(SUM([Sales]))'))).toHaveLength(0);
  });

  it('does not flag RANK returning a number from an IF', () => {
    expect(rankAsMembershipRule.validate(wb('IF RANK(SUM([Sales])) <= 10 THEN RANK(SUM([Sales])) END'))).toHaveLength(0);
  });

  it('does not flag a measure-threshold tiering calc', () => {
    expect(
      rankAsMembershipRule.validate(
        wb('IF SUM([Profit]) &gt;= 10000 THEN &quot;High&quot; ELSEIF SUM([Profit]) &gt;= 0 THEN &quot;Mid&quot; ELSE &quot;Low&quot; END'),
      ),
    ).toHaveLength(0);
  });

  it('does not flag a RANK_UNIQUE reference with no comparison-to-label', () => {
    expect(rankAsMembershipRule.validate(wb('RANK_UNIQUE(SUM([Sales]))'))).toHaveLength(0);
  });

  it('does not flag FIRST()=0 first-mark label idiom', () => {
    expect(rankAsMembershipRule.validate(wb('IF FIRST() = 0 THEN &quot;First&quot; END'))).toHaveLength(0);
    expect(
      rankAsMembershipRule.validate(wb('IF FIRST() &lt;= 0 THEN &quot;First mark&quot; ELSE &quot;&quot; END')),
    ).toHaveLength(0);
  });

  it('does not flag LAST()<=0 latest-mark label idiom', () => {
    expect(
      rankAsMembershipRule.validate(wb('IF LAST() &lt;= 0 THEN &quot;Latest&quot; ELSE &quot;&quot; END')),
    ).toHaveLength(0);
    expect(rankAsMembershipRule.validate(wb('IF LAST() = 0 THEN &quot;Last&quot; END'))).toHaveLength(0);
  });

  it('still flags real membership when FIRST()/LAST()-vs-0 co-occurs', () => {
    expect(
      rankAsMembershipRule.validate(
        wb('IF FIRST() = 0 THEN &quot;First&quot; ELSEIF INDEX() &lt;= [Parameters].[N] THEN &quot;Top&quot; ELSE &quot;Rest&quot; END'),
      ),
    ).toHaveLength(1);
  });

  it('still flags FIRST()/LAST() compared to a parameter', () => {
    expect(
      rankAsMembershipRule.validate(wb('IF FIRST() &lt;= [Parameters].[N] THEN &quot;Top&quot; ELSE &quot;Rest&quot; END')),
    ).toHaveLength(1);
  });

  it('does not flag a workbook with no calc formulas', () => {
    expect(
      rankAsMembershipRule.validate(
        '<workbook><datasources><datasource name="ds"><column name="[Profit]" role="measure"/></datasource></datasources></workbook>',
      ),
    ).toHaveLength(0);
  });

  it('does not throw on malformed or empty XML', () => {
    expect(rankAsMembershipRule.validate('')).toHaveLength(0);
    expect(rankAsMembershipRule.validate('<not-xml')).toHaveLength(0);
  });
});
