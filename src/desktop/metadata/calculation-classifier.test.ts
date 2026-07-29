import { isAggregateOrTableCalc, stripStringsAndComments } from './calculation-classifier.js';

describe('isAggregateOrTableCalc', () => {
  it.each([
    ['a FIXED LOD aggregate', '{FIXED [A] : SUM([B])}', false],
    ['an aggregate calculation', 'SUM([B])', true],
    [
      'the live failing FIXED LOD calculation',
      'FLOOR({FIXED [Team Name] : SUM([Goals])} / 25) * 25',
      false,
    ],
    ['an aggregate outside an INCLUDE LOD block', '{INCLUDE [A] : AVG([B])} + SUM([C])', true],
    ['a table calculation', 'RUNNING_SUM(SUM([B]))', true],
    [
      'an unreachable-in-Tableau table calculation inside an LOD block, pinned only to document the raw table-calc path',
      '{FIXED [A] : RUNNING_SUM(SUM([B]))}',
      true,
    ],
    ['a SUM prefix inside another function name', 'SUMMARY([X])', false],
    ['aggregates inside nested LOD blocks', '{FIXED [A] : AVG({INCLUDE [B] : SUM([C])})}', false],
    ['VAR with a space inside a bracketed field name', '[Var (Budget)] / [Budget]', false],
    ['TOTAL inside a bracketed field name', '[Total (USD)]', false],
    ['RANK inside a bracketed field name', '[Rank (2024)]', false],
    ['COUNT inside a bracketed field name', '[Count (Net)]', false],
    ['a Tableau-escaped bracket inside a field name', '[Weird ]] Total (USD)]', false],
    ['a table-calc name in an LOD dimension', '{FIXED [Rank (Season)] : SUM([X])}', false],
    ['an aggregate between quoted braces', '"{" + STR(SUM([Sales])) + "}"', true],
    ['an aggregate after a string ending in an escaped backslash', "'C:\\\\' + SUM([Sales])", true],
    [
      'an aggregate-looking call after an escaped quote inside a string',
      "'It\\'s SUM([Sales])'",
      false,
    ],
  ])('classifies %s', (_label, formula, expected) => {
    expect(isAggregateOrTableCalc(formula)).toBe(expected);
  });

  it('keeps code after a string ending in an escaped backslash', () => {
    expect(stripStringsAndComments("'C:\\\\' + SUM([Sales])")).toContain('SUM([Sales])');
  });

  it('keeps an escaped quote inside a string', () => {
    expect(stripStringsAndComments("'It\\'s SUM([Sales])'")).not.toContain('SUM([Sales])');
  });
});
