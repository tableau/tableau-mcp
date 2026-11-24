import { changedCalculationDiagnostics } from './flowCalculationDiagnostics.js';
import { prepCalculationFunctions } from './prepCalculationFunctions.js';
import { MAX_PREP_CALCULATION_LENGTH, validatePrepCalculation } from './prepCalculationLanguage.js';

describe('Tableau Prep calculation language', () => {
  it('has a unique signature for every function in the Prep reference', () => {
    const names = prepCalculationFunctions.map(({ name }) => name);
    expect(names).toHaveLength(94);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('DATEPART');
    expect(names).not.toContain('DATEPARTT');
  });

  it.each(prepCalculationFunctions)(
    'accepts the documented arities and rejects excess arguments for $name',
    (fn) => {
      const call = (count: number): string => {
        const expression = `${fn.name.toLowerCase()}(${Array.from({ length: count }, () => '[Value]').join(', ')})`;
        return fn.category === 'Analytic' ? `{ORDERBY [Order Date]: ${expression}}` : expression;
      };
      for (let count = fn.minArgs; count <= fn.maxArgs; count++)
        expect(validatePrepCalculation(call(count))).toEqual([]);
      if (fn.minArgs > 0)
        expect(validatePrepCalculation(call(fn.minArgs - 1))).toMatchObject([
          { code: 'PREP_CALC_ARITY' },
        ]);
      expect(validatePrepCalculation(call(fn.maxArgs + 1))).toMatchObject([
        { code: 'PREP_CALC_ARITY' },
      ]);
    },
  );

  it.each([
    "IF CONTAINS(LOWER([Region]), 'north') AND NOT ISNULL([Sales]) THEN ROUND([Sales], 2) ELSEIF [Sales] = 0 THEN 1e-2 ELSE 0 END",
    "CASE [Group] WHEN 'A' THEN 'O''Brien' WHEN 'B' THEN \"say \"\"hi\"\"\" END",
    '{FIXED [Region], [Year]: SUM([Sales])}',
    '{PARTITION [Customer]: {ORDERBY [Day] ASC, [Idx] DESC: LOOKUP([Sales], -1)}}',
    "IF [District] IN ('North', 'East') THEN [Parameters].[Markup] ELSE .5 END",
    "DATEPART('year', #2026-11-24#) + /* IGNORE(bad) */ 1 // A comment",
  ])('checks formula syntax including documented Tableau constructs', (expression) => {
    expect(validatePrepCalculation(expression)).toEqual([]);
  });

  it.each([
    ['', 'PREP_CALC_SYNTAX'],
    ['IF [Sales] > 0 THEN 1', 'PREP_CALC_SYNTAX'],
    ['CASE [Value] END', 'PREP_CALC_SYNTAX'],
    ['ROUND([Sales],)', 'PREP_CALC_SYNTAX'],
    ['[Sales + 1', 'PREP_CALC_SYNTAX'],
    ['[Sales] /* open', 'PREP_CALC_SYNTAX'],
    ['[Value] 123', 'PREP_CALC_SYNTAX'],
    ["DATEPARTT('year', [Date])", 'PREP_CALC_FUNCTION'],
    ['PREVIOUS_VALUE(0)', 'PREP_CALC_FUNCTION'],
    ["RAWSQL_BOOL('TRUE')", 'PREP_CALC_FUNCTION'],
    ['ROUND()', 'PREP_CALC_ARITY'],
    ["DATEPART('year', 'not a date')", 'PREP_CALC_TYPE'],
    ["ABS('unknown text')", 'PREP_CALC_TYPE'],
    ['RANK()', 'PREP_CALC_ORDER'],
    ['{PARTITION [Group]: ROW_NUMBER()}', 'PREP_CALC_SYNTAX'],
    ['('.repeat(200) + '1' + ')'.repeat(200), 'PREP_CALC_LIMIT'],
    [' '.repeat(MAX_PREP_CALCULATION_LENGTH + 1), 'PREP_CALC_LIMIT'],
  ])('reports the specific error in an invalid or unsupported expression', (expression, code) => {
    expect(validatePrepCalculation(expression)).toMatchObject([{ code, severity: 1 }]);
  });

  it('returns expression-relative UTF-16 ranges across CRLF and supplementary Unicode', () => {
    const diagnostics = validatePrepCalculation('// 😀 ignored\r\n[😀] + TYPO(3)');
    expect(diagnostics).toMatchObject([
      {
        code: 'PREP_CALC_FUNCTION',
        source: 'tableau-prep',
        range: { start: { line: 1, character: 7 }, end: { line: 1, character: 11 } },
      },
    ]);
  });

  it('locates changed calculations in nested Prep nodes and leaves non-calculation expressions alone', () => {
    const nested = {
      nodeType: '.v2023_2_3.MultiRowCalc',
      expression: 'LOOOKUP([Sales])',
    };
    const document = {
      flow: {
        nodes: {
          container: { loomContainer: { nodes: { 'nested/id~': nested } } },
          filter: { nodeType: '.v1.FilterOperation', expression: 'NOT_A_CALCULATED_FIELD()' },
        },
      },
    };
    const result = changedCalculationDiagnostics(document, () => ({ flow: { nodes: {} } }));
    expect(result).toMatchObject({
      count: 1,
      diagnostics: [
        {
          code: 'PREP_CALC_FUNCTION',
          path: '/flow/nodes/container/loomContainer/nodes/nested~1id~0/expression',
        },
      ],
    });
  });

  it('flags a missing formula on a newly added calculated field', () => {
    const document = { flow: { nodes: { calculation: { nodeType: '.v1.AddColumn' } } } };
    const result = changedCalculationDiagnostics(document, () => ({ flow: { nodes: {} } }));
    expect(result).toMatchObject({
      count: 1,
      diagnostics: [
        {
          code: 'PREP_CALC_SYNTAX',
          path: '/flow/nodes/calculation/expression',
        },
      ],
    });
  });
});
