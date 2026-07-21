import { beforeAll, describe, expect, it } from 'vitest';

import { _resetKnowledgeSearchCache, searchKnowledge } from './knowledge/index.js';

describe('knowledge/search', () => {
  // Build the fuse.js index over the whole knowledge corpus ONCE, not per-test:
  // every case here is a read-only search over the same static corpus (nothing
  // mutates it), so a per-test reset just re-reads+re-indexes all ~108 docs on
  // every `it` (~4.6s each → ~18s total). Under CI parallelism that stalled the
  // worker past vitest's 60s onTaskUpdate reporter-RPC deadline (flaky #564 red).
  // beforeAll indexes once and every test reuses the cached index.
  beforeAll(() => _resetKnowledgeSearchCache());

  it('returns ranked hits with expertise URIs for a relevant query', () => {
    const hits = searchKnowledge('high cardinality quick filter', 5);
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.uri).toMatch(/^expertise:\/\/tableau\//);
      expect(h.slug).toBeTruthy();
      expect(typeof h.title).toBe('string');
      expect(typeof h.score).toBe('number');
    }
  });

  it('orders hits by descending score', () => {
    const hits = searchKnowledge('year over year date comparison by month', 5);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it('respects the limit argument', () => {
    const hits = searchKnowledge('dashboard', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('returns [] for an empty query', () => {
    expect(searchKnowledge('', 5)).toEqual([]);
    expect(searchKnowledge('   ', 5)).toEqual([]);
  });

  it('ranks the expected entry #1 (4 cases)', () => {
    const cases: Array<[string, string]> = [
      ['too many quick filters slow dashboard', 'dashboard-performance-efficient-workbooks'],
      ['top 10 by category within region', 'filter-strategy'],
      ['hide rows for security', 'hidden-filter-not-security'],
      ['compare sales by month across years', 'workbook-date-yoy-comparison'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('about-to-err queries surface the corrective entry #1 (8 cases)', () => {
    const cases: Array<[string, string]> = [
      ['quick filters for every dimension', 'dashboard-performance-efficient-workbooks'],
      ['add a filter control per dimension', 'dashboard-performance-efficient-workbooks'],
      ['hide restricted rows with a filter', 'hidden-filter-not-security'],
      ['top N within region', 'filter-strategy'],
      [
        'Ignoring calculated field, field is already defined by data source',
        'calc-name-collides-with-field',
      ],
      ['my chart is blank after adding a calc named like a field', 'calc-name-collides-with-field'],
      ['my gantt bars are flat ticks with no length', 'parse-number-from-compound-string'],
      ['extract the number from a text field like PHI 40-22', 'parse-number-from-compound-string'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('knowledge-route entries rank #1 for their target asks (8 cases)', () => {
    const cases: Array<[string, string]> = [
      ['action filter with blended data sources', 'blend-filter-propagation'],
      [
        'filters not applied to secondary data sources when non-filtered fields are shared',
        'blend-filter-propagation',
      ],
      [
        'current year vs prior year calculation that changes based on the date filter',
        'year-over-year-date-filter-calc',
      ],
      ['prior year value is null after I filter to one year', 'year-over-year-date-filter-calc'],
      ['market share by dividing one value by another', 'aggregate-ratio-window-total-semantics'],
      ['moving average of a calculated percentage', 'aggregate-ratio-window-total-semantics'],
      ['percent of total over a moving sum window', 'aggregate-ratio-window-total-semantics'],
      [
        'grand total not adding up correctly for a calculated field',
        'aggregate-ratio-window-total-semantics',
      ],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('next-lane knowledge-route entries rank #1 for their target asks (8 cases)', () => {
    const cases: Array<[string, string]> = [
      [
        'rolling 12 months current year compared to rolling 12 months prior year',
        'rolling-period-and-prior-value-table-calcs',
      ],
      ['table calculation previous value', 'rolling-period-and-prior-value-table-calcs'],
      ['show change over varying time periods', 'rolling-period-and-prior-value-table-calcs'],
      [
        'use an LOD calculation to look up a value in a related table',
        'lod-across-relationships-and-conditional-aggregation',
      ],
      [
        'how to match two columns and sum the values that match',
        'lod-across-relationships-and-conditional-aggregation',
      ],
      [
        'threshold analysis two ways LOD vs table calc',
        'lod-across-relationships-and-conditional-aggregation',
      ],
      ['overlaying multiple pie charts', 'overlaid-and-stacked-pie-readability'],
      ['stacking 2 pie charts', 'overlaid-and-stacked-pie-readability'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('sankey propose-path entry ranks #1 for its target asks (5 cases)', () => {
    const cases: Array<[string, string]> = [
      ['build a sankey diagram for budget allocation', 'flow-and-sankey'],
      ['flow diagram showing budget allocation across departments', 'flow-and-sankey'],
      ['visualize flow between source and target', 'flow-and-sankey'],
      ['show how money flows between categories', 'flow-and-sankey'],
      ['make a sankey chart of the user journey between steps', 'flow-and-sankey'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('negative control: a generic filter query is not over-captured by the performance entry', () => {
    const hits = searchKnowledge('add a region filter to a dashboard', 5);
    expect(hits[0]?.slug.endsWith('dashboard-performance-efficient-workbooks')).not.toBe(true);
  });

  it('calc-shadow entry ranks #1 for its shadow-style asks (3 cases)', () => {
    const cases: Array<[string, string]> = [
      [
        'apply succeeded but the calculation is wrong',
        'calc-formula-shadowed-by-stale-datasource-calc',
      ],
      ['Tableau kept the old formula', 'calc-formula-shadowed-by-stale-datasource-calc'],
      ['calc renders wrong values after apply', 'calc-formula-shadowed-by-stale-datasource-calc'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('sibling field-collision entry still ranks #1 for its asks (no cross-capture, 3 cases)', () => {
    const cases: Array<[string, string]> = [
      ['why is my worksheet blank after adding a calc', 'calc-name-collides-with-field'],
      ['the chart is completely blank no bars no marks', 'calc-name-collides-with-field'],
      ['calculated field disappeared after apply', 'calc-name-collides-with-field'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });

  it('LOD membership tier calc entry ranks #1 for its asks (5 cases)', () => {
    const cases: Array<[string, string]> = [
      ['top performers bottom performers everyone else', 'lod-membership-tier-calc'],
      ['membership tier calc LOD', 'lod-membership-tier-calc'],
      ['sets lost after apply', 'lod-membership-tier-calc'],
      ['alternative to sets for agent authoring', 'lod-membership-tier-calc'],
      ['collapse middle into everyone else bar', 'lod-membership-tier-calc'],
    ];
    for (const [query, expectedSlugSuffix] of cases) {
      const hits = searchKnowledge(query, 5);
      expect(hits.length, query).toBeGreaterThan(0);
      expect(hits[0].slug.endsWith(expectedSlugSuffix), query).toBe(true);
    }
  });
});
