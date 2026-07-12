import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { aggregateCalcDerivationRule } from './aggregateCalcDerivation.js';

function calcWithCi(formula: string, derivation: string, ciName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table><view>
        <datasource-dependencies datasource="ds">
          <column name="[Calculation_1]" role="measure" type="quantitative" datatype="real">
            <calculation class="tableau" formula="${formula}" />
          </column>
          <column-instance name="${ciName}" column="[Calculation_1]"
                           derivation="${derivation}" pivot="key" type="quantitative" />
        </datasource-dependencies>
      </view></table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('aggregate-calc-derivation rule', () => {
  it.each([
    ['SUM aggregate', 'SUM([Sales])'],
    ['COUNTD aggregate', 'COUNTD([Order ID])'],
    ['ratio of aggregates', 'SUM([Sales]) / SUM([Profit])'],
    ['RANK table calc', 'RANK(SUM([Sales]))'],
    ['INDEX table calc', 'INDEX()'],
    ['WINDOW table calc', 'WINDOW_SUM(COUNT([records]))'],
  ])('errors when a %s calc CI uses none: instead of usr:', (_label, formula) => {
    const issues = aggregateCalcDerivationRule.validate(
      calcWithCi(formula, 'None', '[none:Calculation_1:qk]'),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].ruleId).toBe('aggregate-calc-derivation');
    expect(issues[0].message.toLowerCase()).toContain('usr:');
    expect(issues[0].message.toLowerCase()).toContain('blank');
  });

  it('does not fire when the aggregate calc CI correctly uses usr:/derivation=User', () => {
    const issues = aggregateCalcDerivationRule.validate(
      calcWithCi('SUM([Sales])', 'User', '[usr:Calculation_1:qk]'),
    );
    expect(issues).toHaveLength(0);
  });

  it('does not fire on a row-level calc used as none:', () => {
    const issues = aggregateCalcDerivationRule.validate(
      calcWithCi('[Sales] * 2', 'None', '[none:Calculation_1:qk]'),
    );
    expect(issues).toHaveLength(0);
  });

  it('does not fire on a FIXED-LOD calc used as none:', () => {
    const issues = aggregateCalcDerivationRule.validate(
      calcWithCi('{ FIXED [Customer ID] : SUM([Sales]) }', 'None', '[none:Calculation_1:qk]'),
    );
    expect(issues).toHaveLength(0);
  });

  it('does not fire on a string/boolean IF calc used as none:', () => {
    const issues = aggregateCalcDerivationRule.validate(
      calcWithCi(
        "IF ISNULL([track]) THEN 'Podcast' ELSE 'Music' END",
        'None',
        '[none:Calculation_1:nk]',
      ),
    );
    expect(issues).toHaveLength(0);
  });

  it('blocks validation when registered and an aggregate calc uses none:', () => {
    const result = runValidation(
      calcWithCi('COUNTD([Order ID])', 'None', '[none:Calculation_1:qk]'),
      'workbook',
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.ruleId === 'aggregate-calc-derivation' && i.severity === 'error'),
    ).toBe(true);
  });
});
