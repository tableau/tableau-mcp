import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { undeclaredCalcReferenceRule } from './undeclaredCalcReference.js';

describe('undeclared-calc-reference rule', () => {
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
    const xml = `<worksheet name="S"><table>
      <rows>[none:Calculation_1782866300000:nk]</rows>
      <cols>[none:Calculation_1782866300000:nk]</cols>
      <view><slices><column>[none:Calculation_1999999999999:qk]</column></slices></view>
    </table></worksheet>`;

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

// The rule used to decide "is this calc declared?" with a raw string search for
// `<column\b ... name='[...calc...]'`. `<column\b` also matches `<column-instance`, because
// n->- is a word boundary — so the column-instance every real worksheet carries for a pill made
// the reference declare itself, and the rule reported nothing on any real document.
describe('undeclared-calc-reference is not satisfied by a look-alike declaration', () => {
  const CALC = 'Calculation_123456789012345';
  const rowsRef = `<rows>[federated.abc].[none:${CALC}:nk]</rows>`;

  it("fires when the only other mention is the reference's own column-instance", () => {
    const xml = `<worksheet name='S'><table>
      <view><datasource-dependencies datasource='federated.abc'>
        <column-instance column='[${CALC}]' derivation='None' name='[none:${CALC}:nk]' pivot='key' type='nominal' />
      </datasource-dependencies></view>
      ${rowsRef}
    </table></worksheet>`;

    const issues = undeclaredCalcReferenceRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('fires when the declaration exists only inside an XML comment', () => {
    const xml = `<worksheet name='S'><table>
      <!-- <column name='[${CALC}]'><calculation class='tableau' formula='1'/></column> -->
      ${rowsRef}
    </table></worksheet>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(1);
  });

  it('fires when the declaration sits under a different datasource', () => {
    const xml = `<workbook><datasources>
      <datasource name='federated.abc'/>
      <datasource name='federated.zzz'>
        <column name='[${CALC}]'><calculation class='tableau' formula='1'/></column>
      </datasource>
    </datasources><worksheets><worksheet name='S'><table>${rowsRef}</table></worksheet></worksheets></workbook>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(1);
  });

  it('fires when only a _tpl_-suffixed declaration exists for a bare reference', () => {
    const xml = `<workbook><datasources><datasource name='federated.abc'>
      <column name='[${CALC}_tpl_ab12cd34]'><calculation class='tableau' formula='1'/></column>
    </datasource></datasources><worksheets><worksheet name='S'><table>${rowsRef}</table></worksheet></worksheets></workbook>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(1);
  });

  it('stays silent when the template namespaced BOTH the declaration and the reference', () => {
    const xml = `<workbook><datasources><datasource name='federated.abc'>
      <column name='[${CALC}_tpl_ab12cd34]'><calculation class='tableau' formula='1'/></column>
    </datasource></datasources><worksheets><worksheet name='S'><table>
      <rows>[federated.abc].[none:${CALC}_tpl_ab12cd34:nk]</rows>
    </table></worksheet></worksheets></workbook>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('stays silent when the worksheet fragment declares the calc in its dependency block', () => {
    const xml = `<worksheet name='S'><table>
      <view><datasource-dependencies datasource='federated.abc'>
        <column datatype='string' name='[${CALC}]' role='dimension' type='nominal'>
          <calculation class='tableau' formula="IF 1=1 THEN 'a' END" />
        </column>
        <column-instance column='[${CALC}]' derivation='None' name='[none:${CALC}:nk]' pivot='key' type='nominal' />
      </datasource-dependencies></view>
      ${rowsRef}
    </table></worksheet>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(0);
  });

  it('ignores stale calc ids in inert places such as highlight and tooltip text', () => {
    const xml = `<workbook><worksheets><worksheet name='S'><table>
      <panes><pane><customized-tooltip><formatted-text><run>[none:${CALC}:nk]</run></formatted-text></customized-tooltip></pane></panes>
      <view><manual-sort><dictionary><bucket>&quot;[federated.abc].[none:${CALC}:nk]&quot;</bucket></dictionary></manual-sort></view>
    </table></worksheet></worksheets>
    <windows><window><viewpoint><highlight><color-one-way><field>[federated.abc].[none:${CALC}:nk]</field></color-one-way></highlight></viewpoint></window></windows></workbook>`;

    expect(undeclaredCalcReferenceRule.validate(xml)).toHaveLength(0);
  });
});
