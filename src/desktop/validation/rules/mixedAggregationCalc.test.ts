import { describe, expect, it } from 'vitest';

import { checkFormula, mixedAggregationCalcRule } from './mixedAggregationCalc.js';

const wb = (formula: string): string =>
  `<workbook><datasources><datasource name="ds"><column name="[C]"><calculation class="tableau" formula="${formula}"/></column></datasource></datasources></workbook>`;

describe('mixed-aggregation-calc rule', () => {
  it('flags a mixed-aggregation IF with a bare-field condition and aggregate branches', () => {
    const formula =
      "IF [Profit Tier] = 'Everyone Else' " +
      "THEN SUM([Profit]) / COUNTD(IF [Profit Tier] = 'Everyone Else' THEN [Sub-Category] END) " +
      'ELSE SUM([Profit]) END';

    expect(checkFormula(formula)).toBe(true);

    const issues = mixedAggregationCalcRule.validate(wb(formula));
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('mixed-aggregation-calc');
    expect(issues[0].severity).toBe('warning');
  });

  it('does not flag an aggregated condition', () => {
    const formula =
      "IF MIN([Profit Tier]) = 'Everyone Else' " +
      "THEN SUM([Profit]) / COUNTD(IF [Profit Tier] = 'Everyone Else' THEN [Sub-Category] END) " +
      'ELSE SUM([Profit]) END';

    expect(checkFormula(formula)).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(0);
  });

  it('does not flag a row-level formula with no aggregates in branches', () => {
    const formula = 'IF [P] >= [TopCut] THEN [P] ELSE [TopCut] END';
    expect(checkFormula(formula)).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(0);
  });

  it('flags IIF with a bare-field condition and aggregate branches', () => {
    const formula = "IIF([Profit Tier] = 'Everyone Else', SUM([Profit]), SUM([Profit]) / 2)";
    expect(checkFormula(formula)).toBe(true);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(1);
  });

  it('does not flag IIF with an aggregated condition', () => {
    const formula = "IIF(MIN([Profit Tier]) = 'Everyone Else', SUM([Profit]), SUM([Profit]) / 2)";
    expect(checkFormula(formula)).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(0);
  });

  it('flags CASE with bare field condition and aggregate branches', () => {
    const formula =
      "CASE [Profit Tier] WHEN 'Everyone Else' THEN SUM([Profit]) ELSE SUM([Profit]) END";
    expect(checkFormula(formula)).toBe(true);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(1);
  });

  it('does not flag CASE with aggregated condition', () => {
    const formula =
      "CASE MIN([Profit Tier]) WHEN 'Everyone Else' THEN SUM([Profit]) ELSE SUM([Profit]) END";
    expect(checkFormula(formula)).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(0);
  });

  it('does not fire when aggregates only appear in the condition', () => {
    const formula = 'IF SUM([Sales]) > 0 THEN SUM([Sales]) ELSE 0 END';
    expect(checkFormula(formula)).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(0);
  });

  it('is immune to aggregate-looking strings and comments', () => {
    const formula =
      "IF [Label] = 'SUM([Sales]) > 0' THEN 1 ELSE 0 END // SUM([Sales]) in a comment";
    expect(checkFormula(formula)).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(formula))).toHaveLength(0);
  });

  it('fails open on empty or malformed formulas', () => {
    expect(checkFormula('')).toBe(false);
    expect(mixedAggregationCalcRule.validate(wb(''))).toHaveLength(0);
  });
});
