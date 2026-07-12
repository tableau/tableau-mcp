import { describe, expect, it } from 'vitest';

import { selfReferentialFixedLodRule as rule } from './selfReferentialFixedLod.js';

describe('self-referential-fixed-lod rule', () => {
  it('flags a nested FIXED-in-FIXED rank-by-count membership calc', () => {
    const xml = `<calculation formula="{ FIXED [Sub-Category] : COUNTD(IF { FIXED [Sub-Category] : SUM([Profit]) } >= [x] THEN [Sub-Category] END) }"/>`;
    const issues = rule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('self-referential-fixed-lod');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].suggestion).toMatch(/Top-tab sets|sets-usage-and-creation/);
  });

  it('flags two FIXED LODs compared for membership', () => {
    const xml = `<column><calculation formula="COUNTD(IF {FIXED [Sub-Category]:SUM([Profit])} >= {FIXED [Sub-Category]:SUM([Profit])} THEN 1 END)"/></column>`;
    expect(rule.validate(xml)).toHaveLength(1);
  });

  it('does not flag a single legitimate FIXED LOD ratio', () => {
    const xml = `<calculation formula="SUM([Profit]) / { FIXED : SUM([Profit]) }"/>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a single FIXED per-customer aggregate', () => {
    const xml = `<calculation formula="{ FIXED [Customer Name] : SUM([Sales]) }"/>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag RANK used normally', () => {
    const xml = `<calculation formula="RANK(SUM([Profit]))"/>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag two unrelated FIXED LODs without a rank/count/compare tell', () => {
    const xml = `<calculation formula="{FIXED [Region]:SUM([Sales])} + {FIXED [Category]:SUM([Profit])}"/>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('returns nothing for empty or non-calc XML', () => {
    expect(rule.validate('')).toHaveLength(0);
    expect(rule.validate('<worksheet><rows>[ds].[none:Region:nk]</rows></worksheet>')).toHaveLength(0);
  });
});
