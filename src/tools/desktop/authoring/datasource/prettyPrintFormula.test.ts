import { describe, expect, it } from 'vitest';

import {
  encodeFormulaAttribute,
  formatFormula,
  prettyPrintFormula,
  readFormula,
  tokenizeFormulaForTest as tokenize,
} from './prettyPrintFormula.js';

const WIDTH = 60;

/** Token text sequence, ignoring whitespace/layout -- the semantic fingerprint of a formula. */
function tokenTexts(formula: string): string[] {
  return tokenize(formula).map((t) => t.text);
}

describe('formatFormula - semantics are never altered', () => {
  const formulas = [
    'SUM([Sales])',
    'SUM([Profit])/SUM([Sales])',
    'IF [x] > 0 THEN 1 ELSE 0 END',
    'IF [Category] = "Office Supplies" THEN [Sales] ELSE [Profit] END',
    "SUM(IF YEAR([Order Date]) = YEAR([Anchor Date]) AND DATEPART('dayofyear',[Order Date]) <= DATEPART('dayofyear',[Anchor Date]) THEN [Sales] END)",
    'CASE [Region] WHEN "West" THEN 1 WHEN "East" THEN 2 ELSE 0 END',
    '{ FIXED [Region] : SUM([Sales]) }',
    '[a] + [b] + [c] + [d] + [e] + [f] + [g] + [h] + [i] + [j] + [k]',
    'ZN([Sales]) // trailing note\n/ ZN([Quantity])',
  ];

  it.each(formulas)('preserves the token sequence for: %s', (formula) => {
    expect(tokenTexts(formatFormula(formula))).toEqual(tokenTexts(formula));
  });
});

describe('formatFormula - layout rules', () => {
  it('leaves a short formula on one line', () => {
    expect(formatFormula('SUM([Sales])')).toBe('SUM([Sales])');
    expect(formatFormula('IF [x] > 0 THEN 1 ELSE 0 END')).toBe('IF [x] > 0 THEN 1 ELSE 0 END');
  });

  it('breaks an over-width IF at its keywords with no indentation at top level', () => {
    expect(formatFormula('IF [Category] = "Office Supplies" THEN [Sales] ELSE [Profit] END')).toBe(
      ['IF [Category] = "Office Supplies"', 'THEN [Sales]', 'ELSE [Profit]', 'END'].join('\n'),
    );
  });

  it('never emits a line longer than the target unless it is a single unsplittable token', () => {
    const out = formatFormula(
      "SUM(IF YEAR([Order Date]) = YEAR([Anchor Date]) AND DATEPART('dayofyear',[Order Date]) <= DATEPART('dayofyear',[Anchor Date]) THEN [Sales] END)",
    );
    for (const line of out.split('\n')) {
      if (line.length > WIDTH) {
        // The only allowed overflow is a line holding a single token wider than the budget.
        expect(tokenize(line.trim()).length).toBe(1);
      }
    }
  });
});

describe('formatFormula - conditionals inside a larger expression', () => {
  it('breaks an IF whose flat form fits the width when it is embedded in a larger expression', () => {
    // The IF alone is under 60 chars, but it sits inside a longer concatenation.
    // The compact one-line rendering hides the THEN/ELSE branches -- break them.
    const out = formatFormula(
      'IF [Margin YTD Δpp] >= 0 THEN "▲ " ELSE "▼ " END + STR(ROUND(ABS([Margin YTD Δpp]) * 100, 1)) + " pp vs LY"',
    );
    const lines = out.split('\n');
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^IF \[Margin YTD Δpp\] >= 0$/),
        expect.stringMatching(/^THEN "▲ "$/),
        expect.stringMatching(/^ELSE "▼ "$/),
        expect.stringMatching(/^END/),
      ]),
    );
  });

  it('still leaves a standalone one-line IF flat when it is the whole formula', () => {
    expect(formatFormula('IF [x] > 0 THEN 1 ELSE 0 END')).toBe('IF [x] > 0 THEN 1 ELSE 0 END');
  });

  it('starts the trailing operator on a new line after a broken IF ends', () => {
    const out = formatFormula(
      'IF [Margin YTD Δpp] >= 0 THEN "▲ " ELSE "▼ " END + STR(ROUND(ABS([Margin YTD Δpp]) * 100, 1)) + " pp vs LY"',
    );
    const lines = out.split('\n');
    const endIndex = lines.findIndex((line) => /^END\s*$/.test(line));
    expect(endIndex).toBeGreaterThanOrEqual(0);
    // Nothing may share END's line; the '+' that consumes the IF must start a fresh line.
    expect(lines[endIndex]).toBe('END');
  });
});

describe('formatFormula - never splits a token', () => {
  it('keeps every [field ref] and string literal intact (no newline inside a token)', () => {
    const out = formatFormula(
      'IF [A Very Long Field Name That Exceeds Sixty Chars On Its Own] = "some long constant string value here" THEN 1 ELSE 0 END',
    );
    for (const tok of tokenize(out)) {
      if (tok.type === 'field' || tok.type === 'string') {
        expect(tok.text).not.toContain('\n');
      }
    }
  });
});

describe('encodeFormulaAttribute / readFormula', () => {
  it('encodes newlines as CRLF char refs and escapes XML specials', () => {
    expect(encodeFormulaAttribute('a < b\nc')).toBe('a &lt; b&#13;&#10;c');
    expect(encodeFormulaAttribute("[x] = 'q'")).toBe('[x] = &apos;q&apos;');
  });

  it('round-trips: readFormula reverses encodeFormulaAttribute', () => {
    const text = 'IF [x] = "a"\nTHEN 1\nELSE 0\nEND';
    expect(readFormula(encodeFormulaAttribute(text))).toBe(text);
  });
});

describe('prettyPrintFormula - format + encode for a .twb attribute', () => {
  it('places an encoded newline after a // comment so it cannot swallow following code', () => {
    const attr = prettyPrintFormula('ZN([Sales]) // trailing note\n/ ZN([Quantity])');
    const commentIdx = attr.indexOf('// trailing note');
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    expect(attr.slice(commentIdx)).toMatch(/^\/\/ trailing note&#13;&#10;/);
  });
});
