import { qualifiedNameBracketsRule } from './qualifiedNameBrackets.js';

describe('qualified-name-brackets rule', () => {
  it('flags the doubled-bracket qualified name from the live repro', () => {
    // The exact string Tableau rejected with "Qualified Name Parse Error --- Invalid
    // input: mismatched brackets" on the 2026-07-08 apply-workbook repro.
    const xml =
      '<workbook><worksheets><worksheet name="Sheet 1"><table><view>' +
      '<filter class="categorical" column="[Sample - Superstore].[[Sub-Category]]" />' +
      '</view></table></worksheet></worksheets></workbook>';

    const issues = qualifiedNameBracketsRule.validate(xml);
    const errors = issues.filter((i) => i.severity === 'error');

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].ruleId).toBe('qualified-name-brackets');
    // Names the exact bad string so the agent can find and fix it.
    expect(errors[0].message).toContain('[Sample - Superstore].[[Sub-Category]]');
    // Actionable fix guidance.
    expect(errors[0].message.toLowerCase()).toContain('not nested');
  });

  it('flags a doubled-bracket base column name (no datasource prefix)', () => {
    const xml =
      '<workbook><datasource><column-instance column="[[Sub-Category]]" /></datasource></workbook>';
    const errors = qualifiedNameBracketsRule.validate(xml).filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('[[Sub-Category]]');
  });

  it('flags a malformed qualified name in shelf text content', () => {
    const xml =
      '<workbook><worksheets><worksheet name="s"><table>' +
      '<rows>[Sample - Superstore].[[Sub-Category]]</rows>' +
      '</table></worksheet></worksheets></workbook>';
    const errors = qualifiedNameBracketsRule.validate(xml).filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes a well-formed datasource-qualified reference', () => {
    const xml =
      '<workbook><worksheets><worksheet name="Sheet 1"><table><view>' +
      '<filter class="categorical" column="[Sample - Superstore].[Sub-Category]" />' +
      '</view></table></worksheet></worksheets></workbook>';
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('passes a well-formed column-instance reference with derivation/role', () => {
    const xml =
      '<workbook><worksheet name="s"><table><view><datasource-dependencies>' +
      '<column-instance name="[none:Sub-Category:nk]" column="[Sub-Category]" />' +
      '</datasource-dependencies></view></table></worksheet></workbook>';
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('passes a name that escapes a literal ] as ]] (valid Tableau escaping)', () => {
    // Field literally named `a]b` is written [a]]b]; qualified as [Orders].[none:a]]b:nk].
    const xml = '<workbook><column-instance column="[Orders].[none:a]]b:nk]" /></workbook>';
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('does not scan calculation formula bodies (string literals may contain brackets)', () => {
    // A formula may contain an unbalanced bracket inside a string literal; that is not a
    // qualified-name defect and must not be flagged.
    const xml =
      '<workbook><datasource><column name="[Calc]" caption="a[b">' +
      '<calculation class="tableau" formula=\'IF [Sales] > 0 THEN "x[y" END\' />' +
      '</column></datasource></workbook>';
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a formula-shaped attribute value that is not a pure reference', () => {
    const xml = '<workbook><f column="[Sales] > 5" /></workbook>';
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('returns no issues for malformed XML (well-formed-xml owns that)', () => {
    const xml = '<workbook><unclosed column="[[bad]]"';
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('runs in the workbook, worksheet and dashboard apply contexts', () => {
    expect(qualifiedNameBracketsRule.contexts).toContain('workbook');
    expect(qualifiedNameBracketsRule.contexts).toContain('worksheet');
    expect(qualifiedNameBracketsRule.contexts).toContain('dashboard');
  });
});
