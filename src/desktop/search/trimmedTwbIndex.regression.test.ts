import { readFileSync } from 'fs';

import {
  buildQuerySuite,
  DEFAULT_IN,
  DEFAULT_OUT,
  readSourceEntries,
  SMOKE_QUERIES,
  topKForQuery,
  TWB_RESULTS_LIMIT,
} from '../../scripts/trimTwbExampleIndex.js';

// Point the real searchWorkbookExamples loader at the committed trimmed file so
// the production-scorer cross-check below reads the same bytes we assert on.
// (loadTwbExampleIndex reads TWB_INDEX_PATH at call time; this file is module-
// isolated under vitest, so setting it before the first call is enough.)
process.env.TWB_INDEX_PATH = DEFAULT_OUT;

// Reuse the generator's own entry shape so entries pass to topKForQuery without
// a structural-compatibility cast.
type Entry = ReturnType<typeof readSourceEntries>[number];

// Load once: the full source index (gunzipped from the committed .gz twin) and
// the trimmed, shipped index. The regression compares retrieval over both using
// ONE scorer (topKForQuery) that mirrors production semantics exactly.
const source = readSourceEntries(DEFAULT_IN);
const trimmed = JSON.parse(readFileSync(DEFAULT_OUT, 'utf8')) as Entry[];
const suite = buildQuerySuite(source);

const paths = (entries: Entry[]): string[] => entries.map((e) => e.relativePath).sort();

function overlap(query: string): { src: string[]; trim: string[]; hits: number } {
  const src = paths(topKForQuery(source, query));
  const trim = paths(topKForQuery(trimmed, query));
  const trimSet = new Set(trim);
  return { src, trim, hits: src.filter((p) => trimSet.has(p)).length };
}

// TR2's six regression cases. The source simply does not contain 15 scored hits
// for `top 10` (2) or `data-source-filters` (8) — the alias `filter-topn` maps to
// no feature tag and both surface via the score-0 xml/name fallback — so "full
// recall" for those is 2/2 and 8/8. The other four have >=15 source hits.
const TR2_CASES: Array<[string, number]> = [
  ['parameter', 15],
  ['dashboard', 15],
  ['top 10', 2],
  ['data-source-filters', 8],
  ['reference line', 15],
  ['dual axis', 15],
];

describe('trimmed twb-example-index.json retrieval regression (oracle-seeded)', () => {
  it('pins the full source top-15 for every query in the seeded suite (100% recall)', () => {
    const failures: string[] = [];
    for (const query of suite) {
      const { src, hits } = overlap(query);
      if (hits !== src.length) {
        failures.push(`"${query}": ${hits}/${src.length}`);
      }
    }
    expect(failures, `seeded queries below 100% recall: ${failures.join(', ')}`).toEqual([]);
  });

  it('returns exactly the source top-15 SET for every seeded query', () => {
    // Stronger than recall: trimming introduces no higher-ranked competitor, so
    // the trimmed top-K set equals the source top-K set for seeded queries.
    for (const query of suite) {
      const { src, trim } = overlap(query);
      expect(trim, `set mismatch for "${query}"`).toEqual(src);
    }
  });

  it.each(TR2_CASES)(
    'TR2 case "%s" recovers 100%% of the source top-15 (expected N=%d)',
    (query, expectedN) => {
      const { src, hits } = overlap(query);
      expect(src.length, `source top-K count for "${query}"`).toBe(expectedN);
      expect(hits, `trimmed overlap for "${query}"`).toBe(expectedN);
    },
  );

  it('never returns more than TWB_RESULTS_LIMIT entries', () => {
    for (const query of suite) {
      expect(topKForQuery(trimmed, query).length).toBeLessThanOrEqual(TWB_RESULTS_LIMIT);
    }
  });

  it('replicated scorer matches the production searchWorkbookExamples over the trimmed file', async () => {
    // Guards against drift between this file's FEATURE_ALIASES/scoring mirror and
    // the real implementation: the shipped scorer must rank the trimmed file
    // identically to topKForQuery for the seeded smoke queries.
    const { searchWorkbookExamples } = await import('./searchLibrary.js');
    for (const query of SMOKE_QUERIES) {
      const real = (searchWorkbookExamples(query).twbExamples as Entry[])
        .map((e) => e.relativePath)
        .sort();
      const replicated = paths(topKForQuery(trimmed, query));
      expect(real, `production vs replicated mismatch for "${query}"`).toEqual(replicated);
    }
  });
});

describe('residual long-tail (non-seeded queries) — documented, NOT gated', () => {
  // Honest disclosure: queries outside the oracle suite are only best-effort. The
  // quota trim can drop their source top-15 members, so overlap may be < 100%.
  // These are recorded (not asserted at 100%) so a future regression is visible.
  const LONG_TAIL = ['histogram', 'scatter', 'gantt', 'heatmap', 'tooltip', 'annotation'];

  it('records long-tail overlap without gating it', () => {
    const rows: string[] = [];
    for (const query of LONG_TAIL) {
      const { src, hits } = overlap(query);
      rows.push(`  "${query}": ${hits}/${src.length}`);
      // Sanity only: overlap is a valid subset count.
      expect(hits).toBeGreaterThanOrEqual(0);
      expect(hits).toBeLessThanOrEqual(src.length);
    }
    // eslint-disable-next-line no-console
    console.log(`[long-tail overlap, non-seeded]\n${rows.join('\n')}`);
  });
});
