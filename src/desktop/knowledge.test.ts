import { beforeAll, describe, expect, it } from 'vitest';

import {
  _resetKnowledgeSearchCache,
  searchKnowledge,
  searchKnowledgeWithFallback,
} from './knowledge/index.js';

// Each fuse.js search scans the full document `body` of the ~108-doc corpus with
// ignoreLocation:true (~450ms/query — real work, not a leak). A multi-case block
// runs several such searches, so on a slow/contended CI worker it legitimately
// exceeds vitest's 5s default testTimeout → "Test timed out in 5000ms", which also
// starves the pool onTaskUpdate reporter RPC (the deterministic #564 CI red; local
// runs are just fast enough to squeak under 5s). Raise the per-suite timeout to 30s
// so the honestly-slow relevance blocks have headroom on CI.
describe('knowledge/search', { timeout: 30_000 }, () => {
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

  it('requires the caller to read the top hit before authoring', () => {
    const [top, second] = searchKnowledge('dashboard', 5);

    expect(top.mustReadUri).toBe(top.uri);
    expect(top.instruction).toBe('snippet is not the module — read this URI before authoring');
    expect(second).not.toHaveProperty('mustReadUri');
    expect(second).not.toHaveProperty('instruction');
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

  it('tokenizes short representative asks and surfaces the expected module in the top 3', () => {
    const cases: Array<[string, string]> = [
      ['waterfall sort', 'strategy/viz-design/advanced-chart-builds'],
      ['margin definition', 'strategy/analytics/profitability-margin-definitions'],
      ['pie chart of countries', 'strategy/viz-design/chart-selection'],
    ];

    for (const [query, expectedSlug] of cases) {
      const top3 = searchKnowledge(query, 3);
      expect(
        top3.every((hit) => hit.match === 'keyword'),
        query,
      ).toBe(true);
      expect(
        top3.some((hit) => hit.slug === expectedSlug),
        query,
      ).toBe(true);
    }
  });

  it('ranks bind-first templates ahead of fallback mechanics for named composed charts', () => {
    const queries = [
      'build a waterfall chart',
      'make a funnel chart',
      'build a gantt chart',
      'make a bullet chart',
      'build a box plot',
      'make a slope chart',
      'build a bump chart',
    ];

    for (const query of queries) {
      expect(searchKnowledge(query, 2)[0]?.slug, query).toBe('tactics/workflow/templates');
    }
  });

  it('singularizes only conservative trailing-s plural query tokens before ranking', () => {
    const slugs = (query: string): string[] => searchKnowledge(query, 5).map((hit) => hit.slug);

    expect(slugs('charts')).toEqual(slugs('chart'));
  });

  it('falls back to whole-string fuzzy search when tokenization removes every term', () => {
    const result = searchKnowledgeWithFallback('AI', 5);
    const candidates = result.hits.length > 0 ? result.hits : (result.nearestMatches ?? []);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].mustReadUri).toBe(candidates[0].uri);
    if (result.hits.length > 0) {
      expect(result.hits.every((hit) => hit.match === 'whole-string')).toBe(true);
    } else {
      expect(result.note).toMatch(/nearestMatches/i);
    }
  });

  it('keeps axes intact so axis-related modules remain reachable', () => {
    const hits = searchKnowledge('axes', 5);

    expect(hits.length).toBeGreaterThan(0);
    expect([
      'tactics/workflow/export-worksheet-image-full-canvas',
      'tactics/viz/pane-structure',
      'tactics/viz/marks-and-encodings',
    ]).toContain(hits[0].slug);
  });

  it('promotes long natural queries to keyword-ranked hits with expected docs in the top 3', () => {
    const cases: Array<{ query: string; expectedSlugSuffixes: string[] }> = [
      {
        query: 'I need a country symbol map but bind-template only gives country',
        expectedSlugSuffixes: [
          'tactics/workflow/templates',
          'tactics/viz/worksheets',
          'strategy/viz-design/worksheet-strategy',
        ],
      },
      {
        query: 'Manually build a worksheet by putting a field on a shelf without a canned template',
        expectedSlugSuffixes: ['tactics/viz/worksheets', 'strategy/viz-design/worksheet-strategy'],
      },
      {
        query: 'How do I put fields on Rows and Columns shelves when there is no canned template?',
        expectedSlugSuffixes: ['tactics/viz/worksheets', 'strategy/viz-design/worksheet-strategy'],
      },
      {
        query: 'How can I compare current year to prior year when my date filter changes?',
        expectedSlugSuffixes: ['tactics/data/year-over-year-date-filter-calc'],
      },
      {
        query: 'Why is prior year value blank after filtering the dashboard to one year?',
        expectedSlugSuffixes: ['tactics/data/year-over-year-date-filter-calc'],
      },
      {
        query:
          'What is the safe way to create a cross-sheet region filter across multiple worksheets?',
        expectedSlugSuffixes: ['tactics/viz/cross-sheet-filter-authoring'],
      },
      {
        query: 'How should I calculate market share by dividing values after aggregation?',
        expectedSlugSuffixes: ['tactics/data/aggregate-ratio-window-total-semantics'],
      },
      {
        query: 'How do I make a Sankey diagram showing money flowing between departments?',
        expectedSlugSuffixes: ['strategy/viz-design/flow-and-sankey'],
      },
    ];

    for (const { query, expectedSlugSuffixes } of cases) {
      expect(query.length, query).toBeGreaterThan(32);
      const result = searchKnowledgeWithFallback(query, 5);
      const top3 = result.hits.slice(0, 3);
      expect(top3.length, query).toBeGreaterThan(0);
      expect(
        top3.every((hit) => hit.match === 'keyword'),
        query,
      ).toBe(true);
      expect(
        top3.some((hit) => expectedSlugSuffixes.some((suffix) => hit.slug.endsWith(suffix))),
        query,
      ).toBe(true);
      expect(result).not.toHaveProperty('nearestMatches');
    }
  });

  it('returns nearest keyword matches separately for genuine long-query zero hits', () => {
    const cases: string[] = [
      'florblesnack quazzlewump blitternode zarpwidget plonkshaft narglebeam',
      'xqzvbnm ytrplok mnvczrx pqwlkjh zznobble frandship glorpnado',
    ];

    for (const query of cases) {
      const result = searchKnowledgeWithFallback(query, 5);
      expect(query.length, query).toBeGreaterThan(32);
      expect(result.hits, query).toEqual([]);
      expect(result.nearestMatches?.length, query).toBeGreaterThan(0);
      expect(result.note, query).toMatch(/hits is empty/i);
      expect(result.note, query).toMatch(/nearestMatches/i);
      expect(result.nearestMatches?.[0].mustReadUri, query).toBe(result.nearestMatches?.[0].uri);
    }
  });

  it('keeps terse field-report queries connected to the expected docs', () => {
    const cases: Array<[string, string[]]> = [
      [
        'country symbol map bind template',
        [
          'tactics/workflow/templates',
          'tactics/viz/worksheets',
          'strategy/viz-design/worksheet-strategy',
        ],
      ],
      [
        'manual worksheet authoring put field shelf',
        ['tactics/viz/worksheets', 'strategy/viz-design/worksheet-strategy'],
      ],
      [
        'manual worksheet field shelf no canned template',
        ['tactics/viz/worksheets', 'strategy/viz-design/worksheet-strategy'],
      ],
    ];

    for (const [query, allowedSlugs] of cases) {
      const result = searchKnowledgeWithFallback(query, 5);
      const candidates = result.hits.length > 0 ? result.hits : (result.nearestMatches ?? []);
      expect(candidates.length, query).toBeGreaterThan(0);
      expect(
        candidates.some((hit) => allowedSlugs.includes(hit.slug)),
        query,
      ).toBe(true);
    }
  });

  it('does not add nearest matches when the primary ranker finds hits', () => {
    const query = 'high cardinality quick filter';
    const hits = searchKnowledge(query, 5);
    const result = searchKnowledgeWithFallback(query, 5);

    expect(hits.length).toBeGreaterThan(0);
    expect(result).toEqual({ hits });
    expect(result).not.toHaveProperty('nearestMatches');
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
