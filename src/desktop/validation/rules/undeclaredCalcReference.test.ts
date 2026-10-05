import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { undeclaredCalcReferenceRule } from './undeclaredCalcReference.js';

describe('undeclared-calc-reference rule', () => {
  const liveWorkbookWithStaleHistory = (worksheetBinding = ''): string => `<workbook>
    <datasources>
      <datasource name="federated.live">
        <column caption="Sales" name="[Sales]" datatype="real" role="measure" type="quantitative"/>
      </datasource>
    </datasources>
    <worksheets>
      <worksheet name="Sales">
        <table>
          <rows>[federated.live].[sum:Sales:qk]</rows>
          ${worksheetBinding}
          <style>
            <style-rule element="legend">
              <format attr="col-width" field="[federated.live].[none:Category:nk]">
                <bucket>&quot;[federated.live].[none:Calculation_1111111111111:nk]&quot;</bucket>
              </format>
            </style-rule>
          </style>
        </table>
      </worksheet>
    </worksheets>
    <windows>
      <window class="worksheet" name="Retired Sheet">
        <cards>
          <card type="color" field="[federated.live].[none:Calculation_2222222222222:nk]"/>
        </cards>
      </window>
    </windows>
  </workbook>`;

  it('errors on an auto-named calc referenced but never declared', () => {
    const xml = `<worksheet><table>
      <rows>[Sample - Superstore].[none:Calculation_1782866300000:nk]</rows>
      <sort class="computed" column="[Sample - Superstore].[none:Calculation_1782866300000:nk]"/>
    </table></worksheet>`;

    const issues = undeclaredCalcReferenceRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('undeclared-calc-reference');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/Calculation_1782866300000/);
    expect(issues[0].suggestion).toMatch(/<calculation|declare/i);
  });

  it('does not flag an auto-named calc declared as a column', () => {
    const xml = `<datasource>
      <column caption="Standout Group" name="[Calculation_1782866300000]" datatype="string" role="dimension" type="nominal">
        <calculation class="tableau" formula="IF ... THEN 'Top' END"/>
      </column>
      <worksheet><rows>[Sample - Superstore].[none:Calculation_1782866300000:nk]</rows></worksheet>
    </datasource>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('flags distinct undeclared calcs separately and dedupes repeats', () => {
    const xml = `<x>
      <a>[none:Calculation_1782866300000:nk]</a>
      <b>[none:Calculation_1782866300000:nk]</b>
      <c>[none:Calculation_1999999999999:qk]</c>
    </x>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(2);
  });

  it('does not flag named fields or short numeric names', () => {
    const xml = `<worksheet>
      <rows>[Sample - Superstore].[none:Sub-Category:nk]</rows>
      <cols>[Sample - Superstore].[sum:Profit:qk]</cols>
      <detail>[Sample - Superstore].[none:Calc 2020:nk]</detail>
    </worksheet>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('ignores stale calc references confined to legend buckets and window history', () => {
    expect(undeclaredCalcReferenceRule.validate(liveWorkbookWithStaleHistory())).toEqual([]);
  });

  it('still blocks exactly the undeclared calc bound on a worksheet shelf', () => {
    const issues = undeclaredCalcReferenceRule.validate(
      liveWorkbookWithStaleHistory(
        '<cols>[federated.live].[none:Calculation_3333333333333:nk]</cols>',
      ),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      ruleId: 'undeclared-calc-reference',
      severity: 'error',
    });
    expect(issues[0].message).toContain('Calculation_3333333333333');
    expect(issues[0].message).not.toMatch(/Calculation_(1111111111111|2222222222222)/);
  });

  it('returns nothing for empty or clean XML', () => {
    expect(undeclaredCalcReferenceRule.validate('')).toHaveLength(0);
    expect(undeclaredCalcReferenceRule.validate('<worksheet/>')).toHaveLength(0);
  });

  it('blocks workbook validation when registered', () => {
    const result = runValidation(
      '<workbook><rows>[Sample - Superstore].[none:Calculation_1782866300000:nk]</rows></workbook>',
      'workbook',
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'undeclared-calc-reference')).toBe(true);
  });
});
