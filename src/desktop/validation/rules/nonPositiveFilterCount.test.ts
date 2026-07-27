import { runValidation } from '../registry.js';
import { nonPositiveFilterCountRule } from './nonPositiveFilterCount.js';

function worksheetWith(filter: string): string {
  return `<worksheet name="Sheet 1"><table><view>${filter}</view></table></worksheet>`;
}

function workbookWith(filter = ''): string {
  return `<workbook><worksheets>${worksheetWith(filter)}</worksheets></workbook>`;
}

describe('non-positive-filter-count rule', () => {
  it.each(['0', '-3'])('rejects groupfilter count="%s"', (count) => {
    const xml = worksheetWith(
      `<filter column="[DS].[none:Category:nk]">
        <groupfilter function="end" end="top" count="${count}" />
      </filter>`,
    );

    const issues = nonPositiveFilterCountRule.validate(xml);

    expect(issues).toEqual([
      expect.objectContaining({
        ruleId: 'non-positive-filter-count',
        severity: 'error',
        message: expect.stringContaining(`<groupfilter> count="${count}"`),
      }),
    ]);
    expect(issues[0].message).toContain('AC6CC624');
  });

  it('allows a legacy count="0" groupfilter nested in a group — Desktop persists and round-trips this shape', () => {
    const xml = workbookWith(
      `<group caption="Category Set">
        <groupfilter function="end" end="top" count="0" />
      </group>`,
    );

    expect(nonPositiveFilterCountRule.validate(xml)).toEqual([]);
  });

  it('ignores an unevidenced limit attribute on a filter node', () => {
    const issues = nonPositiveFilterCountRule.validate(
      worksheetWith('<filter column="[Category]" limit="0" />'),
    );

    expect(issues).toEqual([]);
  });

  it.each(['1', '25'])('allows positive filter count "%s"', (count) => {
    const xml = worksheetWith(
      `<filter column="[DS].[none:Category:nk]">
        <groupfilter function="end" end="top" count="${count}" />
      </filter>`,
    );

    expect(nonPositiveFilterCountRule.validate(xml)).toEqual([]);
  });

  it('allows a parameter-backed filter count', () => {
    const xml = worksheetWith(
      `<filter column="[DS].[none:Category:nk]">
        <groupfilter function="end" end="top" count="[Parameters].[Top N]" />
      </filter>`,
    );

    expect(nonPositiveFilterCountRule.validate(xml)).toEqual([]);
  });

  it('leaves a filterless workbook unaffected', () => {
    const result = runValidation(workbookWith(), 'workbook');

    expect(result.issues.some((issue) => issue.ruleId === 'non-positive-filter-count')).toBe(false);
  });

  it.each(['worksheet', 'workbook'] as const)('blocks the %s validation entry point', (context) => {
    const xml =
      context === 'worksheet'
        ? worksheetWith('<groupfilter function="end" count="0" />')
        : workbookWith('<groupfilter function="end" count="0" />');

    const result = runValidation(xml, context);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'non-positive-filter-count',
          severity: 'error',
        }),
      ]),
    );
  });

  it('blocks the dashboard validation entry point', () => {
    const result = runValidation(
      '<dashboard name="Dashboard 1"><groupfilter function="end" count="-1" /></dashboard>',
      'dashboard',
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'non-positive-filter-count',
          severity: 'error',
        }),
      ]),
    );
  });
});
