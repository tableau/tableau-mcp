import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { calcNameFieldCollisionRule } from './calcNameFieldCollision.js';

function datasource(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <datasources>
    <datasource name="federated.1" caption="Bets">
      ${inner}
    </datasource>
  </datasources>
</workbook>`;
}

describe('calc-name-field-collision rule', () => {
  it('errors when a calc name collides with an existing datasource field name', () => {
    const xml = datasource(`
      <column caption="O/U Line" name="[O/U Line]" datatype="real" role="measure" type="quantitative" />
      <column caption="O/U Line" name="[O/U Line]" datatype="real" role="measure" type="quantitative">
        <calculation class="tableau" formula="[Final] - [Betting Line]" />
      </column>`);
    const issues = calcNameFieldCollisionRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].ruleId).toBe('calc-name-field-collision');
    expect(issues[0].message).toContain('O/U Line');
    expect(issues[0].message.toLowerCase()).toContain('already defined');
  });

  it('errors when only the caption collides with a distinct internal name', () => {
    const xml = datasource(`
      <column caption="Sales" name="[Sales]" datatype="real" role="measure" type="quantitative" />
      <column caption="Sales" name="[Calculation_9]" datatype="real" role="measure" type="quantitative">
        <calculation class="tableau" formula="SUM([Amount])" />
      </column>`);
    const issues = calcNameFieldCollisionRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('does not fire when the calc has a distinct name and caption', () => {
    const xml = datasource(`
      <column caption="O/U Line" name="[O/U Line]" datatype="real" role="measure" type="quantitative" />
      <column caption="O/U Diff" name="[O/U Diff]" datatype="real" role="measure" type="quantitative">
        <calculation class="tableau" formula="[Final] - [O/U Line]" />
      </column>`);
    expect(calcNameFieldCollisionRule.validate(xml)).toHaveLength(0);
  });

  it('does not fire when two same-named columns are both calcs', () => {
    const xml = datasource(`
      <column name="[Calculation_1]" datatype="real" role="measure" type="quantitative">
        <calculation class="tableau" formula="SUM([X])" />
      </column>
      <column name="[Calculation_1]" datatype="real" role="measure" type="quantitative">
        <calculation class="tableau" formula="SUM([X])" />
      </column>`);
    expect(calcNameFieldCollisionRule.validate(xml)).toHaveLength(0);
  });

  it('does not fire when a physical field has no same-named calc sibling', () => {
    const xml = datasource(`
      <column caption="Sales" name="[Sales]" datatype="real" role="measure" type="quantitative" />
      <column caption="Profit" name="[Profit]" datatype="real" role="measure" type="quantitative" />`);
    expect(calcNameFieldCollisionRule.validate(xml)).toHaveLength(0);
  });

  it('blocks validation when registered and a collision exists', () => {
    const xml = datasource(`
      <column caption="O/U Line" name="[O/U Line]" datatype="real" role="measure" type="quantitative" />
      <column caption="O/U Line" name="[O/U Line]" datatype="real" role="measure" type="quantitative">
        <calculation class="tableau" formula="[Final] - [Betting Line]" />
      </column>`);
    const result = runValidation(xml, 'workbook');
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.ruleId === 'calc-name-field-collision' && i.severity === 'error'),
    ).toBe(true);
  });
});
