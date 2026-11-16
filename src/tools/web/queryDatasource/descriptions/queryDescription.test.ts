import { queryDatasourceToolDescription20253 } from './queryDescription.2025.3.js';
import { queryDatasourceToolDescription20261 } from './queryDescription.2026.1.js';
import { queryDatasourceToolDescription20263 } from './queryDescription.2026.3.js';
import { queryDatasourceToolDescription } from './queryDescription.js';

const variants = [
  ['2025.3', queryDatasourceToolDescription20253],
  ['2026.1', queryDatasourceToolDescription20261],
  ['2026.3', queryDatasourceToolDescription20263],
  ['default', queryDatasourceToolDescription],
] as const;

const versioned = variants.filter(([name]) => name !== 'default');

// Every gotcha the model cannot learn from the input schema alone. No eval covers
// query-datasource, so a trim that drops one of these would otherwise pass green.
const EVERY_VARIANT = [
  '`context: true`',
  '`context: false`',
  'Set `context: false` on TOP filters to rank/limit results within the established context',
  '"filterType": "TOP"',
  '"fieldToMeasure": { "fieldCaption": "Sales", "function": "SUM" }',
  '"filterType": "QUANTITATIVE_NUMERICAL"',
  '"quantitativeFilterType": "RANGE"',
  '"filterType": "DATE"',
  '"periodType": "MONTHS"',
  '"dateRangeType": "LAST"',
  'QUANTITATIVE_NUMERICAL min/max operators are inclusive',
  'Calculated Fields created as part of a query cannot be referenced in other calculations or filters',
  '10,000 records',
  '"maxDecimalPlaces": 2',
];

const VERSIONED = [
  'Cannot override existing bin fields',
  'binSize must be positive',
  'Measure fields only',
  'A **bin field** with the same fieldCaption and a binSize property',
  '"binSize": 1000',
  '"parameters": [',
  'Parameters affect entire query; filters restrict returned data',
  '**QUANTITATIVE_DATE**',
];

const AD_HOC_CALC_LIMIT = [
  'SET, MATCH, and DATE filters cannot apply functions to a field',
  'SET, MATCH, and DATE filters cannot use ad hoc calculations',
  'filter with QUANTITATIVE_NUMERICAL',
  'IF [Order Date] > #2021-05-05# AND [Order Date] < #2023-07-07# THEN 1 ELSE 0 END',
];

const MATCH_ONLY_FUNCTION_LIMIT =
  'MATCH filters cannot apply functions to a field** - Unlike all other filters';

const EMBEDDED_DATASOURCE = [
  "`datasourceType: 'embedded'`",
  'prefer the embedded copy when both exist',
  '`queryability.isQueryable`',
  '`queryability.reason`',
  'also pass `workbookLuid`',
];

describe('query-datasource descriptions', () => {
  it.each(variants)('%s keeps the facts every server version needs', (_name, text) => {
    for (const fact of EVERY_VARIANT) expect(text).toContain(fact);
  });

  it.each(versioned)('%s keeps bin and parameter rules', (_name, text) => {
    for (const fact of VERSIONED) expect(text).toContain(fact);
  });

  it.each([
    ['2025.3', queryDatasourceToolDescription20253],
    ['default', queryDatasourceToolDescription],
  ])('%s keeps the ad hoc calculation filter limit and its workaround', (_name, text) => {
    for (const fact of AD_HOC_CALC_LIMIT) expect(text).toContain(fact);
  });

  it.each([
    ['2026.1', queryDatasourceToolDescription20261],
    ['2026.3', queryDatasourceToolDescription20263],
  ])('%s keeps the MATCH-only function limit', (_name, text) => {
    expect(text).toContain(MATCH_ONLY_FUNCTION_LIMIT);
  });

  it.each([
    ['2025.3', queryDatasourceToolDescription20253],
    ['default', queryDatasourceToolDescription],
  ])('%s limits computed-condition filters to QUANTITATIVE and TOP', (_name, text) => {
    expect(text).toContain(
      'computed conditions (only available with QUANTITATIVE and TOP filters)',
    );
  });

  it('2026.3 keeps the embedded datasource guidance', () => {
    for (const fact of EMBEDDED_DATASOURCE) {
      expect(queryDatasourceToolDescription20263).toContain(fact);
    }
  });

  it('2026.1 and 2026.3 differ only in the opening paragraph', () => {
    const body = (text: string): string => text.split('\n').slice(3).join('\n');
    expect(body(queryDatasourceToolDescription20263)).toBe(
      body(queryDatasourceToolDescription20261),
    );
  });

  // Exact sizes: each description is sent on every tools/list. Lower these when you trim;
  // a raise needs a reason in review.
  it.each([
    ['2025.3', queryDatasourceToolDescription20253, 12_769],
    ['2026.1', queryDatasourceToolDescription20261, 11_907],
    ['2026.3', queryDatasourceToolDescription20263, 12_755],
    ['default', queryDatasourceToolDescription, 8_178],
  ])('%s is pinned to its measured size', (_name, text, length) => {
    expect(text).toHaveLength(length);
  });
});
