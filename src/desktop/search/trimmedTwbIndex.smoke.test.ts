import { statSync } from 'fs';
import { join } from 'path';

// Smoke test for the TRIMMED, committed twb-example-index.json (see
// src/scripts/trimTwbExampleIndex.ts). Under vitest, DATA_ROOT does not resolve
// to the source data dir (same reason testSetup.ts pins CORPUS_PATH), so point
// the loader at the committed trimmed file explicitly. loadTwbExampleIndex()
// reads TWB_INDEX_PATH at call time, so setting it before any test call is
// enough; this file never mocks searchLibrary, so it exercises the real file.
const TRIMMED_INDEX_PATH = join(process.cwd(), 'src', 'desktop', 'data', 'twb-example-index.json');
process.env.TWB_INDEX_PATH = TRIMMED_INDEX_PATH;

import { searchWorkbookExamples } from './searchLibrary.js';

interface TwbSnippet {
  xml?: string;
  json?: unknown;
}
interface TwbEntry {
  name: string;
  relativePath: string;
  features: string[];
  snippets: Record<string, TwbSnippet>;
}

// Every feature tag present in the source index; the trim must keep all of them.
const ALL_FEATURES = [
  'dual-axis',
  'encoding-color',
  'encoding-density-color',
  'encoding-shape',
  'encoding-size',
  'encoding-size-bar',
  'encoding-space',
  'filter-categorical',
  'filter-quantitative',
  'filter-relative-date',
  'lod',
  'parameter',
  'reference-line',
  'sort',
  'sort-computed',
  'table-calc',
] as const;

function assertUsableEntries(entries: TwbEntry[]): void {
  for (const e of entries) {
    expect(Array.isArray(e.features)).toBe(true);
    const snippets = Object.values(e.snippets);
    expect(snippets.length).toBeGreaterThan(0);
    for (const s of snippets) {
      // The trim keeps the authoritative XML fragment and drops the redundant
      // parsed `json` tree, so every returned snippet must still carry xml.
      expect(typeof s.xml).toBe('string');
      expect((s.xml as string).length).toBeGreaterThan(0);
      expect(s.json).toBeUndefined();
    }
  }
}

describe('trimmed twb-example-index.json is small enough to publish', () => {
  it('stays well under the 2 MB tarball ceiling', () => {
    const bytes = statSync(TRIMMED_INDEX_PATH).size;
    expect(bytes).toBeLessThan(2_000_000);
  });
});

describe('search-workbook-examples over the trimmed index', () => {
  it('returns a capped, populated slice for an empty query', () => {
    const result = searchWorkbookExamples('');
    expect(result.twbTotal).toBeGreaterThan(50);
    expect(result.twbExamples.length).toBe(15); // TWB_RESULTS_LIMIT
    assertUsableEntries(result.twbExamples);
  });

  it('keeps every feature family represented after the trim', () => {
    // Empty-query twbTotal is the full trimmed index length; probe each feature
    // via its own query and confirm at least one indexed example survives.
    for (const feature of ALL_FEATURES) {
      const result = searchWorkbookExamples(feature);
      const hasFeature = result.twbExamples.some((e: TwbEntry) => e.features.includes(feature));
      expect(hasFeature, `feature "${feature}" still has an indexed example`).toBe(true);
    }
  });

  it.each([
    ['dual axis', 'dual-axis'],
    ['table calculation', 'table-calc'],
    ['reference line', 'reference-line'],
    ['level of detail', 'lod'],
    ['relative date', 'filter-relative-date'],
  ])('ranks a %s query to entries tagged %s', (query, expectedFeature) => {
    const result = searchWorkbookExamples(query);
    expect(result.twbExamples.length).toBeGreaterThan(0);
    // The top-scoring result must carry the aliased feature tag (score +10).
    expect(result.twbExamples[0].features).toContain(expectedFeature);
    expect(result.aliasedFeatures).toContain(expectedFeature);
    assertUsableEntries(result.twbExamples);
  });

  it('falls back to a literal xml substring match when no feature matches', () => {
    // "centersize" is neither a feature tag, a feature substring, nor an alias,
    // but appears literally in snippet XML, so only the score-0 xml-substring
    // fallback path can surface it. Proves the trim preserved that path's input.
    const result = searchWorkbookExamples('centersize');
    expect(result.twbExamples.length).toBeGreaterThan(0);
    const surfacedByXml = result.twbExamples.some((e: TwbEntry) =>
      Object.values(e.snippets).some((s) => (s.xml ?? '').toLowerCase().includes('centersize')),
    );
    expect(surfacedByXml).toBe(true);
    assertUsableEntries(result.twbExamples);
  });
});
