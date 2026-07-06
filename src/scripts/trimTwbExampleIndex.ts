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
 * INPUT (kept OUT of the tarball): src/desktop/data-source/twb-example-index.source.json
 *   — this is the untrimmed original. It is not under `src/desktop/data`, so
 *   `build.ts` never copies it, and `.npmignore` publishes only `build/**`.
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
const DEFAULT_IN = join(
  REPO_ROOT,
  'src',
  'desktop',
  'data-source',
  'twb-example-index.source.json',
);
const DEFAULT_OUT = join(REPO_ROOT, 'src', 'desktop', 'data', 'twb-example-index.json');

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

  const inputRaw = readFileSync(opts.inPath, 'utf8');
  const input = JSON.parse(inputRaw) as Entry[];
  if (!Array.isArray(input)) throw new Error(`Expected a JSON array at ${opts.inPath}`);

  const inBytes = statSync(opts.inPath).size;
  const inSnippets = input.reduce((n, e) => n + Object.keys(e.snippets).length, 0);
  const inFeatures = featureCounts(input);

  // Rule 1: drop the redundant `json` snippet field (unless --keep-json).
  const projected = opts.keepJson ? input : input.map(stripJson);

  // Rule 2: dedupe entries with identical snippet payloads. Deterministic
  // representative = smallest relativePath (lexicographic).
  const byPath = [...projected].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const seen = new Set<string>();
  const deduped: Entry[] = [];
  let dupDropped = 0;
  for (const entry of byPath) {
    const key = snippetKey(entry);
    if (seen.has(key)) {
      dupDropped++;
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  // Rule 3: coverage-greedy per-feature cap. Prefer multi-feature entries (keep
  // high-scoring combos) then smaller payloads (bytes) then path (stable). Keep
  // an entry while ANY of its features is still under quota; count all features.
  const ordered = [...deduped].sort((a, b) => {
    if (b.features.length !== a.features.length) return b.features.length - a.features.length;
    const sizeA = jsonBytes(a.snippets);
    const sizeB = jsonBytes(b.snippets);
    if (sizeA !== sizeB) return sizeA - sizeB;
    return a.relativePath.localeCompare(b.relativePath);
  });

  const kept: Entry[] = [];
  const counts: Record<string, number> = {};
  for (const entry of ordered) {
    const underQuota = entry.features.some((f) => (counts[f] ?? 0) < opts.maxPerFeature);
    if (!underQuota) continue;
    kept.push(entry);
    for (const f of entry.features) counts[f] = (counts[f] ?? 0) + 1;
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
  console.log(`bytes   : ${inBytes} -> ${outBytes} (${pct(outBytes, inBytes)})`);
  console.log(`dedupe  : dropped ${dupDropped} entries with duplicate snippet payloads`);
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

main();
