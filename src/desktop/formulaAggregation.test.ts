import {
  createCalculationAggregationResolver,
  formulaRequiresUserDerivation,
} from './formulaAggregation.js';

describe('formulaRequiresUserDerivation', () => {
  it.each([
    ['plain row-level expression', '[Sales] * 2'],
    ['double-quoted aggregate text', 'IF [Label] = "SUM(" THEN [Sales] ELSE 0 END'],
    ['single-quoted aggregate text', "IF [Label] = 'AVG(' THEN [Sales] ELSE 0 END"],
    ['escaped quotes', 'IF [Label] = "MAX(\\"quoted\\")" THEN [Sales] ELSE 0 END'],
    ['doubled quotes', 'IF [Label] = "MIN(""quoted"")" THEN [Sales] ELSE 0 END'],
    ['line comment', '[Sales] // SUM([Sales])\n+ 1'],
    ['block comment', '[Sales] /* AVG([Sales]) */ + 1'],
    ['escaped bracket in identifier', '[SUM( Label]] // MAX(] + 1'],
    ['FIXED LOD', '{ FIXED [Customer ID] : SUM([Sales]) }'],
    ['two-argument MIN', 'MIN([Sales], [Profit])'],
    ['two-argument MAX', 'max ( ZN([Sales]), [Profit] )'],
  ])('returns false for %s', (_label, formula) => {
    expect(formulaRequiresUserDerivation(formula)).toBe(false);
  });

  it.each([
    ['SUM', 'SUM([Sales])'],
    ['spatial COLLECT', 'COLLECT([Geometry])'],
    ['case and whitespace', 'aVg \n ( [Sales] )'],
    ['one-argument MIN', 'MIN([Sales])'],
    ['one-argument MAX', 'max ( [Profit] )'],
    ['nested aggregate', 'ZN(IFNULL(SUM([Sales]), 0))'],
    ['table calculation', 'WINDOW_SUM(COUNT([Records]))'],
    ['aggregate around an LOD', 'SUM({ FIXED [Customer ID] : SUM([Sales]) })'],
    ['RAWSQLAGG_BOOL', 'RAWSQLAGG_BOOL("BOOL_AND(%1)", [Enabled])'],
    ['RAWSQLAGG_DATE', 'RAWSQLAGG_DATE("MAX(%1)", [Order Date])'],
    ['RAWSQLAGG_DATETIME', 'RAWSQLAGG_DATETIME("MAX(%1)", [Created At])'],
    ['RAWSQLAGG_INT', 'RAWSQLAGG_INT("SUM(%1)", [Quantity])'],
    ['RAWSQLAGG_REAL', 'RAWSQLAGG_REAL("SUM(%1)", [Sales])'],
    ['RAWSQLAGG_STR', 'RAWSQLAGG_STR("MAX(%1)", [Category])'],
  ])('returns true for %s', (_label, formula) => {
    expect(formulaRequiresUserDerivation(formula)).toBe(true);
  });
});

describe('createCalculationAggregationResolver', () => {
  it('follows chained calculated-field references to aggregate and table calculations', () => {
    const resolveAggregation = createCalculationAggregationResolver(
      new Map([
        ['[Aggregate Base]', 'SUM([Sales])'],
        ['[Aggregate Alias]', 'ABS([Aggregate Base])'],
        ['[Two Hop Alias]', 'ZN([Aggregate Alias])'],
        ['[Table Calc]', 'INDEX()'],
        ['[Table Calc Alias]', 'ABS([Table Calc])'],
      ]),
    );

    expect(resolveAggregation('[Two Hop Alias]')).toBe(true);
    expect(resolveAggregation('[Table Calc Alias]')).toBe(true);
  });

  it('uses exact escaped internal names without treating captions as aliases', () => {
    const resolveAggregation = createCalculationAggregationResolver(
      new Map([
        ['[Base]]Measure]', 'SUM([Sales])'],
        ['[Internal Alias]', '[Base]]Measure]'],
        ['[Caption Collision]', '[Display Caption]'],
      ]),
    );

    expect(resolveAggregation('[Internal Alias]')).toBe(true);
    expect(resolveAggregation('[Caption Collision]')).toBe(false);
  });

  it('ignores references in strings, comments, LOD braces, and qualified datasource refs', () => {
    const resolveAggregation = createCalculationAggregationResolver(
      new Map([
        ['[SameName]', 'SUM([Sales])'],
        [
          '[Row Level]',
          'IF [Label] = "[SameName]" THEN [Sales] END // [SameName]\n/* [SameName] */',
        ],
        ['[LOD]', '{ FIXED [Category] : [SameName] }'],
        ['[Other Source Alias]', '[OtherSource].[SameName]'],
      ]),
    );

    expect(resolveAggregation('[Row Level]')).toBe(false);
    expect(resolveAggregation('[LOD]')).toBe(false);
    expect(resolveAggregation('[Other Source Alias]')).toBe(false);
  });

  it('keeps bracketed braces inside LOD identifiers and comments inside qualified refs masked', () => {
    const resolveAggregation = createCalculationAggregationResolver(
      new Map([
        ['[Aggregate]', 'SUM([Sales])'],
        ['[LOD]', '{ FIXED [Dimension}Name] : [Aggregate] }'],
        ['[Foreign]', '[OtherSource] /* qualification comment */ . [Aggregate]'],
      ]),
    );

    expect(resolveAggregation('[LOD]')).toBe(false);
    expect(resolveAggregation('[Foreign]')).toBe(false);
  });

  it('terminates unknown references and cycles without query-order-dependent false results', () => {
    const resolveAggregation = createCalculationAggregationResolver(
      new Map([
        ['[Unknown Alias]', 'ABS([Missing])'],
        ['[Cycle A]', '[Cycle B]'],
        ['[Cycle B]', '[Cycle A]'],
        ['[Reachable A]', '[Reachable B] + [Aggregate]'],
        ['[Reachable B]', '[Reachable A]'],
        ['[Aggregate]', 'SUM([Sales])'],
      ]),
    );

    expect(resolveAggregation('[Unknown Alias]')).toBe(false);
    expect(resolveAggregation('[Cycle B]')).toBe(false);
    expect(resolveAggregation('[Cycle A]')).toBe(false);
    expect(resolveAggregation('[Reachable B]')).toBe(true);
    expect(resolveAggregation('[Reachable A]')).toBe(true);
  });

  it('resolves a large row-level dependency DAG with bounded formula lookups', () => {
    class CountingFormulaMap extends Map<string, string> {
      getCount = 0;

      override get(key: string): string | undefined {
        this.getCount += 1;
        return super.get(key);
      }
    }

    const formulas = new CountingFormulaMap([
      ['[Field 0]', '[Sales]'],
      ['[Field 1]', '[Profit]'],
    ]);
    for (let index = 2; index <= 24; index += 1) {
      formulas.set(`[Field ${index}]`, `[Field ${index - 1}] + [Field ${index - 2}]`);
    }

    const resolveAggregation = createCalculationAggregationResolver(formulas);
    const getCountBeforeResolution = formulas.getCount;

    expect(resolveAggregation('[Field 24]')).toBe(false);
    expect(formulas.getCount - getCountBeforeResolution).toBeLessThanOrEqual(formulas.size);
  });
});
