import { formulaRequiresUserDerivation } from './formulaAggregation.js';

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
