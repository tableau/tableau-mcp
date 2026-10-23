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

  it.each(['&#10;', '&amp;#10;', '&amp;#13;', '&amp;#010;', '&amp;#xA;', '&amp;#xD;'])(
    'validates each reference in a line-separated list (%s)',
    (separator) => {
      const xml =
        '<workbook><worksheet><encodings>' +
        `<color column="[Orders].[none:Segment:nk]${separator}[Orders].[none:Forecast Indicator:nk]" />` +
        '</encodings></worksheet></workbook>';

      expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
    },
  );

  it('passes a valid list whose raw attribute newline was normalized to a space', () => {
    const xml = `<workbook><worksheet><encodings><color column="[Orders].[none:Segment:nk]
[Orders].[none:Forecast Indicator:nk]" /></encodings></worksheet></workbook>`;

    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('does not split a valid escaped bracket followed by a literal opening bracket', () => {
    const xml = '<workbook><column-instance column="[Orders].[none:a]] [b:nk]" /></workbook>';

    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('does not split a decoded line break inside one escaped bracket identifier', () => {
    const xml = '<workbook><column-instance column="[Orders].[none:a]]&#10;[b:nk]" /></workbook>';

    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it.each([
    ['normalized space', ' '],
    ['encoded newline', '&#10;'],
  ])(
    'ignores a nested-opener lookalike inside one escaped identifier (%s)',
    (_label, separator) => {
      const xml = `<workbook><column-instance column="[D].[a]]${separator}[.[[b]] [c]" /></workbook>`;

      expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
    },
  );

  it.each(['&#10;', '&amp;#10;'])(
    'still flags a malformed reference within a line-separated list (%s)',
    (separator) => {
      const xml =
        '<workbook><worksheet><encodings>' +
        `<color column="[Orders].[none:Segment:nk]${separator}[Orders].[[Forecast Indicator]]" />` +
        '</encodings></worksheet></workbook>';

      const errors = qualifiedNameBracketsRule.validate(xml).filter((i) => i.severity === 'error');

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('[Orders].[[Forecast Indicator]]');
    },
  );

  it.each([
    ['encoded newline', '&#10;'],
    ['raw newline normalized by the DOM', '\n'],
  ])('flags the exact malformed first member across a %s', (_label, separator) => {
    const malformed = '[Orders].[[Forecast Indicator]]';
    const xml =
      '<workbook><worksheet><encodings>' +
      `<color column="${malformed}${separator}[Orders].[none:Segment:nk]" />` +
      '</encodings></worksheet></workbook>';

    const errors = qualifiedNameBracketsRule.validate(xml).filter((i) => i.severity === 'error');

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(`Malformed qualified name ${JSON.stringify(malformed)}`);
    expect(errors[0].xpath).toBe(`//*[contains(., ${JSON.stringify(malformed)})]`);
  });

  it.each(['&amp;#10;[Orders].[[Forecast Indicator]]', '[Orders].[[Forecast Indicator]]&amp;#10;'])(
    'still flags a malformed sole reference beside an encoded separator (%s)',
    (value) => {
      const xml = `<workbook><column-instance column="${value}" /></workbook>`;

      const errors = qualifiedNameBracketsRule.validate(xml).filter((i) => i.severity === 'error');

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('[Orders].[[Forecast Indicator]]');
    },
  );

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

  it('does not flag an object NAME that looks like a malformed field ref (sheet named [[Q3]])', () => {
    // A worksheet/zone/window/dashboard `name` is an object label, not a field
    // reference — a sheet literally named [[Q3]] must not be rejected.
    const xml =
      "<workbook><worksheets><worksheet name='[[Q3]]'><table/></worksheet></worksheets>" +
      "<dashboards><dashboard name='[[Dash]]'><zones><zone name='[[Z]]'/></zones></dashboard></dashboards>" +
      "<windows><window name='[[Q3]]'/></windows></workbook>";
    expect(qualifiedNameBracketsRule.validate(xml)).toHaveLength(0);
  });

  it('still flags a malformed field reference even when a sheet is named [[Q3]]', () => {
    const xml =
      "<workbook><worksheets><worksheet name='[[Q3]]'><table><view>" +
      "<filter class='categorical' column='[Ds].[[Bad]]' />" +
      '</view></table></worksheet></worksheets></workbook>';
    const errors = qualifiedNameBracketsRule.validate(xml).filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('[Ds].[[Bad]]');
    // The object name itself must NOT be among the flagged strings.
    expect(errors.some((e) => e.message.includes('[[Q3]]'))).toBe(false);
  });

  it('runs in the workbook, worksheet and dashboard apply contexts', () => {
    expect(qualifiedNameBracketsRule.contexts).toContain('workbook');
    expect(qualifiedNameBracketsRule.contexts).toContain('worksheet');
    expect(qualifiedNameBracketsRule.contexts).toContain('dashboard');
  });
});
