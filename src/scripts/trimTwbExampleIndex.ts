/* eslint-disable no-console */

/**
 * Reproducible trim for `src/desktop/data/twb-example-index.json`.
 *
 * WHY: the full index is ~10.3 MB and (once the desktop variant is published)
 * rides into the npm tarball via `build.ts` copying `src/desktop/data`. Only the
 * `search-workbook-examples` tool consumes it, through
 * `src/desktop/search/searchLibrary.ts::searchWorkbookExamples`, which:
 *   - scores each entry on its `features` tags (exact +10 / partial +5),
 *     `name` substring (+3), and — only when nothing else matched — a literal
 *     substring hit in a snippet's `xml` (+1);
 *   - returns at most TWB_RESULTS_LIMIT (15) entries.
 * It never reads `snippets[*].json` (a mechanical parse of `xml`, i.e. redundant).
 *
 * RETRIEVAL-QUALITY GUARANTEE (oracle seeding): a naive per-feature quota trim
 * silently dropped the source top-15 for name-sensitive and XML-fallback queries
 * (e.g. `parameter`, `dashboard`, `data-source-filters`). To prevent that, before
 * applying the quota we compute the SOURCE top-15 for a generated query suite —
 * every feature tag, every `FEATURE_ALIASES` phrase, and curated name/XML-fallback
 * smoke queries — and PIN those entries into the kept set unconditionally. The
 * K=`maxPerFeature` quota then adds breadth on top. See the source-vs-trimmed
 * regression test at `src/desktop/search/trimmedTwbIndex.regression.test.ts`.
 *
 * INPUT (kept OUT of the tarball): src/desktop/data-source/twb-example-index.source.json.gz
 *   — a gzip of the untrimmed original (the 10 MB uncompressed twin is not
 *   committed). It is not under `src/desktop/data`, so `build.ts` never copies it,
 *   and `.npmignore` publishes only `build/**`. `.gz` inputs are gunzipped in-memory.
 * OUTPUT (the committed, shipped file): src/desktop/data/twb-example-index.json
 *
 * Re-generate with:  npx tsx src/scripts/trimTwbExampleIndex.ts
 * Tune with flags:   --max-per-feature <N>  --keep-json  --in <path>  --out <path>  --pretty
 *
 * The transform is deterministic (stable sorts, no randomness): same input +
 * same flags => byte-identical output.
 */

import { readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';

interface Snippet {
  xml?: string;
  json?: unknown;
  [k: string]: unknown;
}
interface Entry {
  name: string;
  relativePath: string;
  features: string[];
  snippets: Record<string, Snippet>;
}

interface Options {
  inPath: string;
  outPath: string;
  maxPerFeature: number;
  keepJson: boolean;
  pretty: boolean;
}

const REPO_ROOT = process.cwd();
export const DEFAULT_IN = join(
  REPO_ROOT,
  'src',
  'desktop',
  'data-source',
  'twb-example-index.source.json.gz',
);
export const DEFAULT_OUT = join(REPO_ROOT, 'src', 'desktop', 'data', 'twb-example-index.json');

/** Max results `searchWorkbookExamples` returns; the oracle pins this many per query. */
export const TWB_RESULTS_LIMIT = 15;

/**
 * VERBATIM mirror of `FEATURE_ALIASES` in
 * `src/desktop/search/searchLibrary.ts`. The oracle must score with the exact
 * production semantics; if that table changes, update this copy (and the
 * regression test cross-checks the real scorer to catch drift).
 */
export const FEATURE_ALIASES: Record<string, string[]> = {
  'running total': ['table-calc'],
  'running sum': ['table-calc'],
  'running avg': ['table-calc'],
  'running average': ['table-calc'],
  'window sum': ['table-calc'],
  'window avg': ['table-calc'],
  'window calculation': ['table-calc'],
  'table calculation': ['table-calc'],
  'table calc': ['table-calc'],
  rank: ['table-calc'],
  index: ['table-calc'],
  lookup: ['table-calc'],
  'percent of total': ['table-calc'],
  'level of detail': ['lod'],
  'fixed lod': ['lod'],
  'include lod': ['lod'],
  'exclude lod': ['lod'],
  'lod expression': ['lod'],
  'fixed expression': ['lod'],
  'bar chart': ['encoding-color'],
  'bar graph': ['encoding-color'],
  'color encoding': ['encoding-color'],
  'color by': ['encoding-color'],
  'size encoding': ['encoding-size'],
  'size by': ['encoding-size'],
  'shape encoding': ['encoding-shape'],
  'date filter': ['filter-relative-date'],
  'relative date': ['filter-relative-date'],
  'date range': ['filter-relative-date'],
  'top n': ['filter-topn'],
  'top 10': ['filter-topn'],
  'top filter': ['filter-topn'],
  'categorical filter': ['filter-categorical'],
  'dimension filter': ['filter-categorical'],
  'range filter': ['filter-quantitative'],
  'measure filter': ['filter-quantitative'],
  'reference line': ['reference-line'],
  'average line': ['reference-line'],
  'constant line': ['reference-line'],
  'trend line': ['reference-line'],
  'dual axis': ['dual-axis'],
  'dual-axis': ['dual-axis'],
  'combined axis': ['dual-axis'],
  'secondary axis': ['dual-axis'],
  parameter: ['parameter'],
  'calculated field': ['lod', 'table-calc'],
  'calc field': ['lod', 'table-calc'],
  'sort by': ['sort', 'sort-computed'],
  sorted: ['sort', 'sort-computed'],
  'custom sort': ['sort-computed'],
  'computed sort': ['sort-computed'],
};

/**
 * Curated name/XML-fallback smoke queries that are not (all) feature tags or
 * alias phrases. Includes TR2's six regression cases plus the xml-substring
 * fallback probe (`centersize`) that the smoke test relies on.
 */
export const SMOKE_QUERIES = [
  'parameter',
  'dashboard',
  'top 10',
  'data-source-filters',
  'reference line',
  'dual axis',
  'centersize',
];

/** VERBATIM mirror of `expandQueryAliases` in searchLibrary.ts. */
export function expandQueryAliases(query: string): { tags: string[]; rawQuery: string } {
  const lower = query.toLowerCase().trim();
  const tags = new Set<string>();
  for (const [phrase, featureTags] of Object.entries(FEATURE_ALIASES)) {
    if (lower.includes(phrase)) {
      for (const tag of featureTags) tags.add(tag);
    }
  }
  return { tags: [...tags], rawQuery: lower };
}

/** VERBATIM mirror of the twb branch of `searchWorkbookExamples` scoring. */
function scoreEntry(entry: Entry, allTerms: string[], q: string): number {
  let score = 0;
  for (const term of allTerms) {
    if (entry.features.some((f) => f === term)) {
      score += 10;
    } else if (entry.features.some((f) => f.includes(term) || term.includes(f))) {
      score += 5;
    }
  }
  if (entry.name.includes(q)) score += 3;
  if (score === 0) {
    for (const snippet of Object.values(entry.snippets)) {
      const xml = snippet?.xml;
      if (xml && xml.toLowerCase().includes(q)) {
        score += 1;
        break;
      }
    }
  }
  return score;
}

/**
 * Deterministic top-K for a query, matching production retrieval. Entries are
 * canonicalised to relativePath order first — the same order the committed
 * (relativePath-sorted) index loads in, so ties break identically to the real
 * `searchWorkbookExamples` reading the shipped file. Returns at most K entries.
 */
export function topKForQuery(
  entries: Entry[],
  query: string,
  k: number = TWB_RESULTS_LIMIT,
): Entry[] {
  const { tags, rawQuery: q } = expandQueryAliases(query);
  const allTerms = [q, ...tags];
  const ordered = [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of ordered) {
    const score = scoreEntry(entry, allTerms, q);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.entry);
}

/** Feature tags + alias phrases + curated smoke queries. Order is irrelevant. */
export function buildQuerySuite(entries: Entry[]): string[] {
  const suite = new Set<string>();
  for (const e of entries) for (const f of e.features) suite.add(f);
  for (const phrase of Object.keys(FEATURE_ALIASES)) suite.add(phrase);
  for (const query of SMOKE_QUERIES) suite.add(query);
  return [...suite];
}

/** Read + parse the source array; transparently gunzips a `.gz` input. */
export function readSourceEntries(inPath: string): Entry[] {
  const buf = readFileSync(inPath);
  const text = inPath.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const parsed = JSON.parse(text) as Entry[];
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array at ${inPath}`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    inPath: process.env.TWB_SOURCE_PATH ?? DEFAULT_IN,
    outPath: process.env.TWB_INDEX_OUT_PATH ?? DEFAULT_OUT,
    maxPerFeature: 80,
    keepJson: false,
    pretty: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--max-per-feature') opts.maxPerFeature = Number(argv[++i]);
    else if (arg === '--keep-json') opts.keepJson = true;
    else if (arg === '--pretty') opts.pretty = true;
    else if (arg === '--in') opts.inPath = argv[++i];
    else if (arg === '--out') opts.outPath = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(opts.maxPerFeature) || opts.maxPerFeature < 1) {
    throw new Error(`--max-per-feature must be a positive integer (got ${opts.maxPerFeature})`);
  }
  return opts;
}

/** Serialized-byte size of a value as it would appear in the JSON output. */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** Canonical identity of an entry's snippet payload (feature -> xml), key-sorted. */
function snippetKey(entry: Entry): string {
  const canonical: Record<string, string> = {};
  for (const feature of Object.keys(entry.snippets).sort()) {
    canonical[feature] = entry.snippets[feature]?.xml ?? '';
  }
  return JSON.stringify(canonical);
}

function stripJson(entry: Entry): Entry {
  const snippets: Record<string, Snippet> = {};
  for (const [feature, snippet] of Object.entries(entry.snippets)) {
    const { json: _json, ...rest } = snippet;
    snippets[feature] = rest;
  }
  return { ...entry, snippets };
}

function featureCounts(entries: Entry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    for (const f of e.features) counts[f] = (counts[f] ?? 0) + 1;
  }
  return counts;
}

function main(): void {
  const opts = parseArgs(process.argv);

  const input = readSourceEntries(opts.inPath);

  const inBytes = statSync(opts.inPath).size;
  const inSnippets = input.reduce((n, e) => n + Object.keys(e.snippets).length, 0);
  const inFeatures = featureCounts(input);

  // Rule 1: drop the redundant `json` snippet field (unless --keep-json).
  const projected = opts.keepJson ? input : input.map(stripJson);

  // Rule 2 (oracle seeding): compute the SOURCE top-15 for the whole query suite
  // and pin those entries. Scoring uses only features/name/xml, which projection
  // preserves, so pins computed on `projected` match production retrieval.
  const suite = buildQuerySuite(projected);
  const pinnedPaths = new Set<string>();
  for (const query of suite) {
    for (const entry of topKForQuery(projected, query)) pinnedPaths.add(entry.relativePath);
  }

  const byPath = [...projected].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const kept: Entry[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  const addEntry = (e: Entry): void => {
    kept.push(e);
    seen.add(snippetKey(e));
    for (const f of e.features) counts[f] = (counts[f] ?? 0) + 1;
  };

  // Pass A: pin oracle entries unconditionally (exempt from dedupe and quota).
  for (const e of byPath) {
    if (pinnedPaths.has(e.relativePath)) addEntry(e);
  }
  const pinnedCount = kept.length;

  // Pass B: dedupe the remaining (non-pinned) entries with identical snippet
  // payloads. Deterministic representative = smallest relativePath; a pinned
  // entry already occupies its payload key, so its non-pinned duplicates drop.
  let dupDropped = 0;
  const deduped: Entry[] = [];
  for (const e of byPath) {
    if (pinnedPaths.has(e.relativePath)) continue;
    const key = snippetKey(e);
    if (seen.has(key)) {
      dupDropped++;
      continue;
    }
    seen.add(key);
    deduped.push(e);
  }

  // Pass C: coverage-greedy per-feature cap on the remainder. Prefer multi-feature
  // entries then smaller payloads (bytes) then path (stable). Pinned entries have
  // already been counted, so the quota adds breadth on top of the oracle set.
  const ordered = [...deduped].sort((a, b) => {
    if (b.features.length !== a.features.length) return b.features.length - a.features.length;
    const sizeA = jsonBytes(a.snippets);
    const sizeB = jsonBytes(b.snippets);
    if (sizeA !== sizeB) return sizeA - sizeB;
    return a.relativePath.localeCompare(b.relativePath);
  });
  for (const entry of ordered) {
    const underQuota = entry.features.some((f) => (counts[f] ?? 0) < opts.maxPerFeature);
    if (!underQuota) continue;
    addEntry(entry);
  }

  // Deterministic committed order.
  kept.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const output = opts.pretty ? JSON.stringify(kept, null, 2) : JSON.stringify(kept);
  writeFileSync(opts.outPath, output, 'utf8');

  const outBytes = Buffer.byteLength(output, 'utf8');
  const outSnippets = kept.reduce((n, e) => n + Object.keys(e.snippets).length, 0);
  const outFeatures = featureCounts(kept);

  const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(1)}%`;
  console.log('--- trimTwbExampleIndex ---');
  console.log(`in : ${opts.inPath}`);
  console.log(`out: ${opts.outPath}`);
  console.log(
    `options: maxPerFeature=${opts.maxPerFeature} keepJson=${opts.keepJson} pretty=${opts.pretty}`,
  );
  console.log('');
  console.log(`entries : ${input.length} -> ${kept.length} (${pct(kept.length, input.length)})`);
  console.log(`snippets: ${inSnippets} -> ${outSnippets} (${pct(outSnippets, inSnippets)})`);
  console.log(`bytes   : ${inBytes} (gz in) -> ${outBytes} out`);
  console.log(`dedupe  : dropped ${dupDropped} non-pinned entries with duplicate snippet payloads`);
  console.log('');
  console.log(`oracle  : suite=${suite.length} queries, pinned=${pinnedCount} entries`);
  for (const query of SMOKE_QUERIES) {
    const src = topKForQuery(projected, query).map((e) => e.relativePath);
    const trim = new Set(topKForQuery(kept, query).map((e) => e.relativePath));
    const overlap = src.filter((p) => trim.has(p)).length;
    console.log(`  "${query}": source top-${src.length}, trimmed overlap ${overlap}/${src.length}`);
  }
  console.log('');
  console.log('per-feature entry counts (before -> after):');
  for (const f of Object.keys(inFeatures).sort()) {
    console.log(`  ${f}: ${inFeatures[f]} -> ${outFeatures[f] ?? 0}`);
  }
  const missing = Object.keys(inFeatures).filter((f) => !outFeatures[f]);
  if (missing.length > 0) {
    throw new Error(`Trim dropped all examples for feature(s): ${missing.join(', ')}`);
  }
}

// Run only when invoked directly as a script (not when imported by tests).
const invokedAsScript =
  !process.env.VITEST &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('trimTwbExampleIndex.ts');
if (invokedAsScript) main();
