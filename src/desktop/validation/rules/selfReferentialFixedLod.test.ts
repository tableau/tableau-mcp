import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { selfReferentialFixedLodRule as rule } from './selfReferentialFixedLod.js';

describe('self-referential-fixed-lod rule', () => {
  it('flags a nested FIXED-in-FIXED rank-by-count membership calc', () => {
    const xml =
      '<calculation formula="{ FIXED [Sub-Category] : COUNTD(IF { FIXED [Sub-Category] : SUM([Profit]) } >= [x] THEN [Sub-Category] END) }"/>';
    const issues = rule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('self-referential-fixed-lod');
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].suggestion).toMatch(/lod-membership-tier-calc/);
    expect(issues[0].suggestion).not.toMatch(/Top-tab|sets-usage-and-creation/);
  });

  it('flags two FIXED LODs compared for membership', () => {
    const xml =
      '<column><calculation formula="COUNTD(IF {FIXED [Sub-Category]:SUM([Profit])} >= {FIXED [Sub-Category]:SUM([Profit])} THEN 1 END)"/></column>';
    expect(rule.validate(xml)).toHaveLength(1);
  });

  it('does not flag a single legitimate FIXED LOD ratio', () => {
    const xml = '<calculation formula="SUM([Profit]) / { FIXED : SUM([Profit]) }"/>';
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a single FIXED per-customer aggregate', () => {
    const xml = '<calculation formula="{ FIXED [Customer Name] : SUM([Sales]) }"/>';
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag RANK used normally', () => {
    const xml = '<calculation formula="RANK(SUM([Profit]))"/>';
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag two unrelated FIXED LODs without a rank/count/compare tell', () => {
    const xml =
      '<calculation formula="{FIXED [Region]:SUM([Sales])} + {FIXED [Category]:SUM([Profit])}"/>';
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('allows a share-of-total ratio of two COUNTD FIXED LODs', () => {
    const xml =
      '<calculation formula="{FIXED [Region]: COUNTD([Customer ID])} / {FIXED : COUNTD([Customer ID])}"/>';
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('flags a same-dimension FIXED comparison written with XML-escaped operators', () => {
    const xml =
      '<calculation formula="COUNTD(IF {FIXED [Sub-Category]:SUM([Profit])} &gt;= {FIXED [Sub-Category]:AVG([Profit])} THEN [Sub-Category] END)"/>';
    expect(rule.validate(xml)).toHaveLength(1);
  });

  it.each([
    [
      'RFM quintile against a global percentile (knowledge calc-fields.md)',
      'IF [Monetary (Sales)] &gt;= { FIXED : PERCENTILE({ FIXED [Customer ID] : SUM([Sales]) }, 0.8) } THEN 5 ELSE 1 END',
    ],
    [
      'share-of-total threshold',
      '{FIXED [Region]: SUM([Sales])} / {FIXED : SUM([Sales])} &gt;= 0.2',
    ],
    [
      'above the global average',
      '{FIXED [Customer ID]: SUM([Sales])} &gt;= {FIXED : AVG({FIXED [Customer ID]: SUM([Sales])})}',
    ],
    [
      'cohort window',
      '{FIXED [Customer ID]: MIN([Order Date])} &lt;= {FIXED : MIN([Order Date])} + 365',
    ],
    [
      'the tier pattern written inline',
      'IF {FIXED [Sub-Category]: SUM([Profit])} &gt;= {FIXED : PERCENTILE({FIXED [Sub-Category]: SUM([Profit])}, 0.8)} THEN "Top" ELSE "Other" END',
    ],
  ])('allows a global-threshold comparison: %s', (_name, formula) => {
    expect(rule.validate(`<calculation formula='${formula}'/>`)).toHaveLength(0);
  });

  it('flags the same-dimension comparison written with > instead of >=', () => {
    const xml =
      '<calculation formula="COUNTD(IF {FIXED [Sub-Category]:SUM([Profit])} &gt; {FIXED [Sub-Category]:SUM([Profit])} THEN 1 END)"/>';
    expect(rule.validate(xml)).toHaveLength(1);
  });

  it.each([
    [
      'first-order sales per customer',
      '{FIXED [Customer ID]: SUM(IF [Order Date] = {FIXED [Customer ID]: MIN([Order Date])} THEN [Sales] END)}',
    ],
    [
      'last-order sales per customer',
      '{FIXED [Customer ID]: SUM(IF [Order Date] = {FIXED [Customer ID]: MAX([Order Date])} THEN [Sales] END)}',
    ],
    [
      'above-average orders per region',
      '{FIXED [Region]: SUM(IF [Sales] &gt;= {FIXED [Region]: AVG([Sales])} THEN 1 END)}',
    ],
    [
      'customer grew year over year',
      '{FIXED [Customer ID]: SUM(IF YEAR([Order Date]) = 2024 THEN [Sales] END)} &gt;= {FIXED [Customer ID]: SUM(IF YEAR([Order Date]) = 2023 THEN [Sales] END)}',
    ],
    ['region hit target', '{FIXED [Region]: SUM([Sales])} &gt;= {FIXED [Region]: SUM([Target])}'],
    [
      'FIXED inside a string literal',
      'IF {FIXED [Region]: SUM([Sales])} &gt;= 100 THEN "{FIXED [Region]: x} &gt;= {FIXED [Region]: y}" END',
    ],
    [
      'FIXED inside a comment',
      '// was {FIXED [A]: COUNTD([S])} &gt;= {FIXED [A]: COUNTD([S])}&#10;{FIXED [A]: SUM([S])}',
    ],
    [
      'VIP flag with an unrelated >=',
      'IF {FIXED [Customer ID]: SUM([Sales])} &gt; 1000 AND [Profit] &gt;= 0 AND {FIXED [Customer ID]: COUNTD([Order ID])} &gt; 2 THEN "VIP" END',
    ],
  ])('allows a correct per-member calc: %s', (_name, formula) => {
    expect(rule.validate(`<calculation formula='${formula}'/>`)).toHaveLength(0);
  });

  it.each([
    [
      'Consumer vs Corporate',
      '{FIXED [Region]: SUM(IF [Segment]="Consumer" THEN [Sales] END)} &gt;= {FIXED [Region]: SUM(IF [Segment]="Corporate" THEN [Sales] END)}',
    ],
    [
      'East vs West with =',
      '{FIXED [Cust]: SUM(IF [Region]="East" THEN [S] END)} = {FIXED [Cust]: SUM(IF [Region]="West" THEN [S] END)}',
    ],
    [
      "'month' vs 'year' in the dimension",
      "{FIXED DATETRUNC('month',[d]): SUM([S])} &gt; {FIXED DATETRUNC('year',[d]): SUM([S])}",
    ],
    [
      'a block comment holding an old version',
      '/* {FIXED [A]: SUM([S])} &gt;= {FIXED [A]: SUM([S])} */&#10;{FIXED [A]: SUM([S])} / 2',
    ],
  ])('does not flag LODs that differ only in a literal or sit in a comment: %s', (_n, formula) => {
    expect(rule.validate(`<calculation formula='${formula}'/>`)).toHaveLength(0);
  });

  it("still flags a real positive when a field name holds an apostrophe: [Cust's]", () => {
    const xml =
      '<calculation formula="IF [Cust\'s]=1 THEN 0 END + COUNTD(IF {FIXED [S]:SUM([P])} &gt;= {FIXED [S]:SUM([P])} THEN 1 END) + [Bob\'s]"/>';
    expect(rule.validate(xml)).toHaveLength(1);
  });

  it('never fires on a FIXED formula in the shipped templates or fixtures', () => {
    const root = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tbm|twb|xml)$/.test(entry.name)) files.push(full);
      }
    };
    walk(root);
    let checked = 0;
    for (const file of files) {
      const xml = readFileSync(file, 'utf8');
      if (!/FIXED/i.test(xml)) continue;
      checked++;
      expect(rule.validate(xml), file).toHaveLength(0);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('returns nothing for empty or non-calc XML', () => {
    expect(rule.validate('')).toHaveLength(0);
    expect(rule.validate('<worksheet><rows>[ds].[none:Region:nk]</rows></worksheet>')).toHaveLength(
      0,
    );
  });
});
