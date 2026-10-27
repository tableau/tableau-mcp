import { describe, expect, it } from 'vitest';
import * as xpath from 'xpath';

import { introducedBlockingValidationIssues, runValidation } from '../registry.js';
import { aggregateCalcDerivationRule } from './aggregateCalcDerivation.js';
import { parseXml } from './parseXml.js';

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

  it('counts equivalent invalid instances so a new duplicate remains detectable', () => {
    const xml = calcWithCi('SUM([Sales])', 'None', '[none:Calculation_1:qk]').replace(
      '</datasource-dependencies>',
      '<column-instance name="[none:Calculation_1:qk]" column="[Calculation_1]" derivation="None" pivot="key" type="quantitative" /></datasource-dependencies>',
    );

    const issues = aggregateCalcDerivationRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].occurrenceCount).toBe(2);
  });

  it('isolates calculated fields and column instances by datasource name', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="A">
      <column name="[Shared]"><calculation formula="SUM([Sales])" /></column>
    </datasource>
    <datasource name="B">
      <column name="[Shared]"><calculation formula="[Sales] * 2" /></column>
    </datasource>
  </datasources>
  <worksheets><worksheet name="Sheet 1"><table><view>
    <datasource-dependencies datasource="B">
      <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
    </datasource-dependencies>
  </view></table></worksheet></worksheets>
</workbook>`;

    expect(aggregateCalcDerivationRule.validate(xml)).toHaveLength(0);
  });

  it('rejects None for an aggregate field in its own datasource', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="A">
      <column name="[Shared]"><calculation formula="SUM([Sales])" /></column>
    </datasource>
    <datasource name="B">
      <column name="[Shared]"><calculation formula="[Sales] * 2" /></column>
    </datasource>
  </datasources>
  <worksheets><worksheet name="Sheet 1"><table><view>
    <datasource-dependencies datasource="A">
      <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
    </datasource-dependencies>
    <datasource-dependencies datasource="B">
      <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
    </datasource-dependencies>
  </view></table></worksheet></worksheets>
</workbook>`;

    const issues = aggregateCalcDerivationRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].xpath).toContain('[@datasource="A"]');
    expect(issues[0].occurrenceCount).toBe(1);
  });

  it('validates a worksheet-only document from its local datasource dependencies', () => {
    const xml = `<?xml version="1.0"?>
<worksheet name="Sheet 1"><table><view>
  <datasource-dependencies datasource="A">
    <column name="[Shared]"><calculation formula="SUM([Sales])" /></column>
    <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
  </datasource-dependencies>
</view></table></worksheet>`;

    expect(aggregateCalcDerivationRule.validate(xml)).toEqual([
      expect.objectContaining({
        ruleId: 'aggregate-calc-derivation',
        occurrenceCount: 1,
        xpath: expect.stringContaining('[@datasource="A"]'),
      }),
    ]);
  });

  it('inherits top-level calculated fields into matching datasource dependencies', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources><datasource name="A">
    <column name="[Top Level]"><calculation formula="SUM([Sales])" /></column>
  </datasource></datasources>
  <worksheets><worksheet name="Sheet 1"><table><view>
    <datasource-dependencies datasource="A">
      <column-instance name="[none:Top Level:qk]" column="[Top Level]" derivation="None" />
    </datasource-dependencies>
  </view></table></worksheet></worksheets>
</workbook>`;

    expect(aggregateCalcDerivationRule.validate(xml)).toHaveLength(1);
  });

  it('uses local calculated fields in preference to matching top-level definitions', () => {
    const xml = `<?xml version="1.0"?>
<workbook>
  <datasources><datasource name="A">
    <column name="[Shared]"><calculation formula="SUM([Sales])" /></column>
  </datasource></datasources>
  <worksheets><worksheet name="Sheet 1"><table><view>
    <datasource-dependencies datasource="A">
      <column name="[Shared]"><calculation formula="[Sales] * 2" /></column>
      <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
    </datasource-dependencies>
  </view></table></worksheet></worksheets>
</workbook>`;

    expect(aggregateCalcDerivationRule.validate(xml)).toHaveLength(0);
  });

  it('rejects a transitive alias of an aggregate calculated field', () => {
    const xml = `<?xml version="1.0"?>
<worksheet name="Sheet 1"><table><view>
  <datasource-dependencies datasource="A">
    <column name="[Aggregate]"><calculation formula="SUM([Sales])" /></column>
    <column name="[Alias]"><calculation formula="[Aggregate]" /></column>
    <column-instance name="[none:Alias:qk]" column="[Alias]" derivation="None" />
  </datasource-dependencies>
</view></table></worksheet>`;

    const issues = aggregateCalcDerivationRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('[Alias]');
  });

  it('keeps datasource ownership in baseline issue identity', () => {
    const datasource = (name: string): string => `
      <datasource name="${name}">
        <column name="[Shared]"><calculation formula="SUM([Sales])" /></column>
        <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
      </datasource>`;
    const baseline = aggregateCalcDerivationRule.validate(
      `<?xml version="1.0"?><workbook><datasources>${datasource('A')}</datasources></workbook>`,
    );
    const candidate = aggregateCalcDerivationRule.validate(
      `<?xml version="1.0"?><workbook><datasources>${datasource('B')}</datasources></workbook>`,
    );

    const introduced = introducedBlockingValidationIssues(baseline, candidate);

    expect(introduced).toHaveLength(1);
    expect(introduced[0].xpath).toContain('[@name="B"]');
  });

  it('counts repeated invalid instances within the same datasource', () => {
    const xml = `<?xml version="1.0"?>
<worksheet name="Sheet 1"><table><view>
  <datasource-dependencies datasource="A">
    <column name="[Shared]"><calculation formula="SUM([Sales])" /></column>
    <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
    <column-instance name="[none:Shared:qk]" column="[Shared]" derivation="None" />
  </datasource-dependencies>
</view></table></worksheet>`;

    const issues = aggregateCalcDerivationRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].occurrenceCount).toBe(2);
  });

  it('builds an executable XPath when datasource and field names contain both quote types', () => {
    const xml = `<?xml version="1.0"?>
<worksheet name="Sheet 1"><table><view>
  <datasource-dependencies datasource="Bob's &quot;Data&quot;">
    <column name="[Owner's &quot;Total&quot;]"><calculation formula="SUM([Sales])" /></column>
    <column-instance name="[none:Owner's &quot;Total&quot;:qk]" column="[Owner's &quot;Total&quot;]" derivation="None" />
  </datasource-dependencies>
</view></table></worksheet>`;

    const issues = aggregateCalcDerivationRule.validate(xml);
    const doc = parseXml(xml);

    expect(issues).toHaveLength(1);
    expect(doc).not.toBeNull();
    expect(() => xpath.select(issues[0].xpath!, doc as unknown as Node)).not.toThrow();
    expect(xpath.select(issues[0].xpath!, doc as unknown as Node)).toHaveLength(1);
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

  it('does not fire when aggregate-looking text appears only in strings, comments, or field names', () => {
    const issues = aggregateCalcDerivationRule.validate(
      calcWithCi(
        'IF [SUM( Label]] //] = &quot;SUM(&quot; THEN [Sales] ELSE 0 END /* AVG([Profit]) */',
        'None',
        '[none:Calculation_1:qk]',
      ),
    );

    expect(issues).toHaveLength(0);
  });

  it.each([
    ['two-argument MIN', 'MIN([Sales], [Profit])'],
    ['two-argument MAX with whitespace', 'max ( [Sales] , [Profit] )'],
    ['FIXED LOD', '{ FIXED [Customer ID] : SUM([Sales]) }'],
  ])('does not fire on a row-level %s expression', (_label, formula) => {
    expect(
      aggregateCalcDerivationRule.validate(calcWithCi(formula, 'None', '[none:Calculation_1:qk]')),
    ).toHaveLength(0);
  });

  it.each([
    ['one-argument MIN', 'min ( [Sales] )'],
    ['one-argument MAX', 'MAX([Profit])'],
    ['nested aggregate', 'ZN(IFNULL(SUM([Sales]), 0))'],
    ['spatial COLLECT', 'COLLECT([Geometry])'],
    ['RAWSQL aggregate', 'RAWSQLAGG_REAL(&quot;SUM(%1)&quot;, [Sales])'],
  ])('fires on a true %s expression', (_label, formula) => {
    expect(
      aggregateCalcDerivationRule.validate(calcWithCi(formula, 'None', '[none:Calculation_1:qk]')),
    ).toHaveLength(1);
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
