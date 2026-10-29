import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { parseAndValidateDatasourcesFilterString } from '../datasources/datasourcesFilterUtils.js';
import { parseAndValidateViewsFilterString } from '../views/viewsFilterUtils.js';
import { parseAndValidateWorkbooksFilterString } from '../workbooks/workbooksFilterUtils.js';
import { contentTagSearchLabelsSchema, withContentTagFilter } from './contentTagFilter.js';

describe('content tag discovery filters', () => {
  it.each([
    [undefined, undefined, undefined],
    ['name:eq:Sales', undefined, 'name:eq:Sales'],
    [undefined, ['Sales'], 'tags:eq:Sales'],
    [undefined, ['Sales', 'Sales'], 'tags:eq:Sales'],
    [undefined, ['Sales', 'Finance', 'Sales'], 'tags:in:[Sales,Finance]'],
    [undefined, ['Sales', 'sales'], 'tags:in:[Sales,sales]'],
    [undefined, ['売上 #1', 'Café:50%'], 'tags:in:[売上 #1,Café:50%]'],
    ['projectName:eq:Finance', ['Sales'], 'projectName:eq:Finance,tags:eq:Sales'],
    ['', ['pending-deletion-2026-10-14'], 'tags:eq:pending-deletion-2026-10-14'],
  ] as const)('builds a decoded native filter for %j / %j', (filter, labels, expected) => {
    expect(withContentTagFilter(filter, labels ? [...labels] : undefined)).toBe(expected);
  });

  it.each(
    [
      [],
      [''],
      [' '],
      [' leading'],
      ['trailing '],
      ['A&B'],
      ['A,B'],
      ['Sales],name:eq:Secret'],
      ['[Sales]'],
      ['A%2CB'],
      ['A%252CB'],
      ['%5D'],
      ['%26'],
      ['\u0000'],
      ['\n'],
      ['\u007f'],
      ['\ud800'],
      ['x'.repeat(257)],
      Array.from({ length: 51 }, (_, i) => `label${i}`),
    ].map((labels) => ({ labels })),
  )('rejects unrepresentable or over-cap labels $labels', ({ labels }) => {
    expect(() => withContentTagFilter(undefined, labels)).toThrow(ArgsValidationError);
  });

  it.each(['tags:eq:Old', 'tags:in:[Old,Older]', 'projectName:eq:Finance,tags:eq:Old'])(
    'rejects conflicting raw tags clause %s',
    (filter) => {
      expect(() => withContentTagFilter(filter, ['Sales'])).toThrow('not both');
    },
  );

  it('does not impose the mutation namespace guard on read-only cleanup tag lookup', () => {
    expect(
      contentTagSearchLabelsSchema.safeParse(['pending-deletion', 'PENDING-DELETION-invalid'])
        .success,
    ).toBe(true);
  });

  it.each([
    ['workbook', parseAndValidateWorkbooksFilterString],
    ['view', parseAndValidateViewsFilterString],
    ['datasource', parseAndValidateDatasourcesFilterString],
  ] as const)(
    'uses the existing %s parser for exact, OR and last-field-wins semantics',
    (_type, parse) => {
      expect(parse('tags:eq:Sales')).toBe('tags:eq:Sales');
      expect(parse('tags:in:[Sales,Finance]')).toBe('tags:in:[Sales,Finance]');
      expect(parse('tags:eq:Sales,tags:eq:Finance')).toBe('tags:eq:Finance');
      expect(parse('projectName:eq:Finance,tags:eq:Sales')).toBe(
        'projectName:eq:Finance,tags:eq:Sales',
      );
    },
  );
});
