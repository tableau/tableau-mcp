import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { undeclaredAggregateOkRefRule } from './undeclaredAggregateOkRef.js';

function worksheetWith(shelf: string, deps = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <datasource-dependencies datasource="ds">${deps}</datasource-dependencies>
        </view>
        <rows>${shelf}</rows>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('undeclared-aggregate-ok-ref rule', () => {
  it('warns on an undeclared aggregate :ok shelf reference', () => {
    const issues = undeclaredAggregateOkRefRule.validate(worksheetWith('[ds].[sum:Sales:ok]'));

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('[sum:Sales:ok]');
    expect(issues[0].suggestion).toContain('[sum:Sales:qk]');
  });

  it.each(['avg', 'ctd', 'med', 'stp', 'vrp'])('catches the %s aggregate prefix', (prefix) => {
    const issues = undeclaredAggregateOkRefRule.validate(
      worksheetWith(`[ds].[${prefix}:Profit:ok]`),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain(`[${prefix}:Profit:ok]`);
  });

  it('stays silent when a matching column-instance is declared', () => {
    const deps =
      '<column-instance column="[Sales]" name="[sum:Sales:ok]" derivation="Sum" pivot="key" type="ordinal" />';

    expect(
      undeclaredAggregateOkRefRule.validate(worksheetWith('[ds].[sum:Sales:ok]', deps)),
    ).toHaveLength(0);
  });

  it('stays silent on the canonical :qk aggregate reference', () => {
    expect(
      undeclaredAggregateOkRefRule.validate(worksheetWith('[ds].[sum:Sales:qk]')),
    ).toHaveLength(0);
  });

  it('stays silent on dimension and date :ok instances', () => {
    const issues = undeclaredAggregateOkRefRule.validate(
      worksheetWith('([ds].[none:Region:nk] * [ds].[tmn:Order Date:ok])'),
    );

    expect(issues).toHaveLength(0);
  });

  it('dedupes repeated occurrences of the same reference', () => {
    const issues = undeclaredAggregateOkRefRule.validate(
      worksheetWith('([ds].[sum:Sales:ok] + [ds].[sum:Sales:ok])'),
    );

    expect(issues).toHaveLength(1);
  });

  it('warns on a filter-attribute reference', () => {
    const xml = `<workbook><worksheets><worksheet name="S"><table><view>
      <filter class="categorical" column="[ds].[sum:Sales:ok]" />
    </view><rows /></table></worksheet></worksheets></workbook>`;

    expect(undeclaredAggregateOkRefRule.validate(xml)).toHaveLength(1);
  });

  it('tolerates whitespace around the declaration attribute equals sign', () => {
    const deps =
      '<column-instance column="[Sales]" name = "[sum:Sales:ok]" derivation="Sum" pivot="key" type="ordinal" />';

    expect(
      undeclaredAggregateOkRefRule.validate(worksheetWith('[ds].[sum:Sales:ok]', deps)),
    ).toHaveLength(0);
  });

  it('matches declaration case-insensitively', () => {
    const deps =
      '<column-instance column="[Sales]" name="[SUM:Sales:OK]" derivation="Sum" pivot="key" type="ordinal" />';

    expect(
      undeclaredAggregateOkRefRule.validate(worksheetWith('[ds].[sum:Sales:ok]', deps)),
    ).toHaveLength(0);
  });

  it('does not block validation because it is a warning', () => {
    const result = runValidation(
      worksheetWith('[Sample - Superstore].[sum:Sales:ok]'),
      'worksheet',
    );

    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.ruleId === 'undeclared-aggregate-ok-ref')).toBe(true);
  });
});
