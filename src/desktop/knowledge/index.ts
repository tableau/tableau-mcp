import Fuse from 'fuse.js';

import { getConfiguredKnowledgeDir, listKnowledgeSlugs, readKnowledgeBySlug } from '../assets.js';

export interface KnowledgeResource {
  uri: string;
  name: string;
  description: string;
  mimeType: 'text/markdown';
}

export function getKnowledgeDir(): string {
  return getConfiguredKnowledgeDir();
}

function knowledgeCorpusEmptyError(): Error {
  return new Error(`Knowledge corpus is empty; expected assets under ${getKnowledgeDir()}`);
}

export function getKnowledgeCorpusEntryCount(): number {
  return listKnowledgeSlugs().length;
}

function extractMeta(content: string, fallbackName: string): { name: string; description: string } {
  const lines = content.split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  const name = titleLine ? titleLine.replace(/^#\s+/, '') : fallbackName;
  const titleIdx = titleLine ? lines.indexOf(titleLine) : -1;
  for (let i = titleIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#') && !line.startsWith('```')) {
      const description = line.length > 200 ? line.slice(0, 200) + '...' : line;
      return { name, description };
    }
  }
  return { name, description: '' };
}

let _cache: KnowledgeResource[] | null = null;

export function listKnowledgeResources(): KnowledgeResource[] {
  if (_cache) return _cache;
  const slugs = listKnowledgeSlugs();
  if (slugs.length === 0) throw knowledgeCorpusEmptyError();

  _cache = slugs.map((slug) => {
    const content = readKnowledgeBySlug(slug);
    const { name, description } =
      content !== null ? extractMeta(content, slug) : { name: slug, description: '' };
    return { uri: `expertise://tableau/${slug}`, name, description, mimeType: 'text/markdown' };
  });
  return _cache;
}

/** GitHub-style heading slug: "## Best Practices" -> "best-practices". */
function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** Every heading in a document, as { level, text, lineIndex }. */
function headings(lines: string[]): Array<{ level: number; text: string; line: number }> {
  const out: Array<{ level: number; text: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (match) out.push({ level: match[1].length, text: match[2].trim(), line: i });
  }
  return out;
}

/**
 * The top-level section slugs of one knowledge module, in document order. Lets an agent name
 * the section it wants (via a URI fragment) without paying for the whole file first. Only H1/H2
 * are listed — the corpus mandates the same four H2s per module, so the list stays a few dozen
 * bytes; a fragment can still address a deeper heading by slug.
 */
export function readKnowledgeSections(slug: string): string[] {
  const content = readKnowledgeBySlug(slug);
  if (content === null) return [];
  return headings(content.split('\n'))
    .filter((heading) => heading.level <= 2)
    .map((heading) => headingSlug(heading.text));
}

/**
 * One section of a document: its heading line through the line before the next heading of
 * the same or a higher level. `wanted` matches either the heading slug or its literal text.
 */
function extractSection(content: string, wanted: string): string | null {
  const lines = content.split('\n');
  const all = headings(lines);
  let decoded = wanted;
  try {
    decoded = decodeURIComponent(wanted);
  } catch {
    // A literal or malformed percent escape is still valid heading text.
  }
  const target = headingSlug(decoded);
  const index = all.findIndex((heading) => headingSlug(heading.text) === target);
  if (index === -1) return null;

  const start = all[index];
  const next = all.slice(index + 1).find((heading) => heading.level <= start.level);
  return lines
    .slice(start.line, next ? next.line : lines.length)
    .join('\n')
    .trimEnd();
}

/**
 * Read a knowledge module. `expertise://tableau/<slug>` returns the whole file;
 * `expertise://tableau/<slug>#<section>` returns just that section (the corpus's largest
 * module is 33,543 bytes, and an agent usually needs one rule out of it). Returns null when
 * the URI is malformed, the module is missing, or the fragment names no section.
 */
export function readKnowledgeResource(uri: string): string | null {
  const PREFIX = 'expertise://tableau/';
  if (!uri.startsWith(PREFIX)) return null;
  const rest = uri.slice(PREFIX.length);
  const hash = rest.indexOf('#');
  const slug = hash === -1 ? rest : rest.slice(0, hash);
  const section = hash === -1 ? '' : rest.slice(hash + 1);
  if (!slug || slug.includes('..') || slug.includes('\\') || slug.startsWith('/')) return null;

  const content = readKnowledgeBySlug(slug);
  if (content === null || !section) return content;
  return extractSection(content, section);
}

export function clearKnowledgeCache(): void {
  _cache = null;
}

interface KnowledgeDoc {
  slug: string;
  uri: string;
  title: string;
  tags: string;
  searchTerms: string;
  whenToUse: string;
  body: string;
}

let _knowledgeDocs: KnowledgeDoc[] | null = null;
let _knowledgeKeywordFuse: Fuse<KnowledgeDoc> | null = null;
let _knowledgeBroadNearestFuse: Fuse<KnowledgeDoc> | null = null;

// Weights are raw exponents here, not normalized ratios — but unlike the command index, this
// path never ranks on the fuse score directly. Every query is an extended-search include
// (`'token`), so each per-key score is 0 and the record score collapses to EPSILON^(sum of
// matched key weights / sqrt(field length)); the composite ranker below consumes it only as the
// sub-1 tiebreaker `1 - avgFuseScore`. Scaling these weights UP therefore destroys the ranking
// rather than sharpening it: measured over the 31 recovered agent queries, the tiebreaker holds
// 121 distinct values of 142 at the weights below, 89 at 4x, 40 at 10x, and exactly 1 with
// ignoreFieldNorm on. Leave them small.
const knowledgeSearchKeys = [
  { name: 'searchTerms', weight: 0.3 },
  { name: 'tags', weight: 0.22 },
  { name: 'title', weight: 0.2 },
  { name: 'whenToUse', weight: 0.18 },
  { name: 'slug', weight: 0.06 },
  // NB: the full document `body` is deliberately NOT a fuse search key. With
  // ignoreLocation:true fuse fuzzy-scans every char of all ~108 doc bodies per
  // query (~450ms each) — the dominant cost, and it CPU-starved CI workers past
  // the pool's 60s onTaskUpdate RPC deadline. Ranking is driven by the curated
  // metadata (searchTerms/tags/title/whenToUse/slug); body added negligible signal
  // at weight 0.04. `body` is still kept on the doc for the result snippet.
];

const QUERY_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'without',
  'into',
  'from',
  'over',
  'only',
  'not',
  'no',
  'a',
  'an',
  'any',
  'are',
  'but',
  'can',
  'does',
  'how',
  'need',
  'this',
  'when',
  'what',
  'why',
  'tableau',
  'using',
  'use',
]);

const QUERY_TOOL_JARGON = new Set([
  'bind-template',
  'tableau-bind-template',
  'validate-proposal',
  'tableau-validate-proposal',
  'tabdoc',
  'tabui',
  'nextaction',
]);

/** Value of a `- Label: value` metadata line (case-insensitive), or "". */
function fieldLine(lines: string[], label: string): string {
  const re = new RegExp(
    `^[-*]?\\s*${label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*:\\s*(.+)$`,
    'i',
  );
  for (const l of lines) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  return '';
}

/** Prose under the first heading matching `headingRe`, up to the next heading. */
function sectionBody(lines: string[], headingRe: RegExp): string {
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    const t = lines[i].trim();
    if (t) out.push(t.replace(/^[-*]\s+/, ''));
  }
  return out.join(' ').slice(0, 600);
}

function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const dot = t.indexOf('. ');
  const cut = dot > 0 ? dot + 1 : t.length;
  const s = t.slice(0, Math.min(cut, 200)).trim();
  return s.length < t.length ? s : t.length > 200 ? t.slice(0, 200) + '...' : t;
}

function buildKnowledgeIndex(): KnowledgeDoc[] {
  if (_knowledgeDocs) return _knowledgeDocs;
  const docs: KnowledgeDoc[] = [];

  for (const slug of listKnowledgeSlugs()) {
    // Skip meta/navigation files (basename starts with `_`)
    if (slug.split('/').pop()?.startsWith('_')) continue;

    const content = readKnowledgeBySlug(slug);
    if (!content) continue;

    const lines = content.split('\n');
    const titleLine = lines.find((l) => l.startsWith('# '));
    const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : slug;

    docs.push({
      slug,
      uri: `expertise://tableau/${slug}`,
      title,
      tags: fieldLine(lines, 'Tags'),
      searchTerms: fieldLine(lines, 'Relevant user prompts/search terms'),
      whenToUse: sectionBody(lines, /^#{2,}\s+When to Use\b/i),
      body: content,
    });
  }

  if (docs.length === 0) throw knowledgeCorpusEmptyError();

  docs.sort((a, b) => a.slug.localeCompare(b.slug));
  _knowledgeDocs = docs;
  return docs;
}

function ensureKnowledgeKeywordFuse(): Fuse<KnowledgeDoc> {
  if (_knowledgeKeywordFuse) return _knowledgeKeywordFuse;
  _knowledgeKeywordFuse = new Fuse(buildKnowledgeIndex(), {
    keys: knowledgeSearchKeys,
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    useExtendedSearch: true,
  });
  return _knowledgeKeywordFuse;
}

export interface KnowledgeHit {
  uri: string;
  slug: string;
  title: string;
  score: number;
  snippet: string;
  match: 'whole-string' | 'keyword' | 'nearest';
  mustReadUri?: string;
  instruction?: string;
  sections?: string[];
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  nearestMatches?: KnowledgeHit[];
  note?: string;
  topHitBody?: string;
}

export const ZERO_HIT_NEAREST_MATCHES_NOTE =
  'hits is empty; nearestMatches contains the nearest keyword results, not exact hits.';

// Representative ambiguous searches have 0–0.028 top-two gaps; clearly targeted calculation
// searches have 0.181–0.449 gaps. Keep the gate conservatively between those distributions.
const CONFIDENT_TOP_HIT_SCORE_GAP = 0.15;
const TOP_HIT_BODY_MAX_BYTES = 6_144;
const TOP_HIT_BODY_TRUNCATION_MARKER = `\n\n[TRUNCATED: body exceeds ${TOP_HIT_BODY_MAX_BYTES}-byte cap]`;

const MUST_READ_INSTRUCTION =
  'snippet is not the module — read this URI before authoring; append #<section> from sections to read one section instead of the whole module';

// Only the top hit carries `sections` — it is the module the agent is told to read, and the
// list costs a few hundred bytes against a module that can run past 30,000.
function requireTopHitRead(hits: KnowledgeHit[]): KnowledgeHit[] {
  if (hits.length === 0) return hits;
  return [
    {
      ...hits[0],
      mustReadUri: hits[0].uri,
      instruction: MUST_READ_INSTRUCTION,
      sections: readKnowledgeSections(hits[0].slug),
    },
    ...hits.slice(1),
  ];
}

function hasConfidentTopHit(hits: KnowledgeHit[]): boolean {
  return (
    hits.length === 1 ||
    (hits.length > 1 && hits[0].score - hits[1].score >= CONFIDENT_TOP_HIT_SCORE_GAP)
  );
}

function capTopHitBody(body: string): string {
  if (Buffer.byteLength(body, 'utf8') <= TOP_HIT_BODY_MAX_BYTES) return body;

  const prefixBudget =
    TOP_HIT_BODY_MAX_BYTES - Buffer.byteLength(TOP_HIT_BODY_TRUNCATION_MARKER, 'utf8');
  const prefix: string[] = [];
  let prefixBytes = 0;
  for (const character of body) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (prefixBytes + characterBytes > prefixBudget) break;
    prefix.push(character);
    prefixBytes += characterBytes;
  }
  return prefix.join('') + TOP_HIT_BODY_TRUNCATION_MARKER;
}

function ensureKnowledgeBroadNearestFuse(): Fuse<KnowledgeDoc> {
  if (_knowledgeBroadNearestFuse) return _knowledgeBroadNearestFuse;
  _knowledgeBroadNearestFuse = new Fuse(buildKnowledgeIndex(), {
    keys: knowledgeSearchKeys,
    threshold: 1,
    ignoreLocation: true,
    includeScore: true,
  });
  return _knowledgeBroadNearestFuse;
}

function keywordFallbackQuery(query: string): string {
  const tokens = queryTokens(query);
  return tokens.length > 0 ? tokens.join(' | ') : query.trim();
}

function singularizeToken(word: string): string {
  if (word.length >= 5 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('es')) {
    return word.slice(0, -1);
  }
  return word;
}

function queryTokens(query: string): string[] {
  const tokens = (query.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 2 && !QUERY_STOPWORDS.has(word) && !QUERY_TOOL_JARGON.has(word))
    .map(singularizeToken);
  return [...new Set(tokens)];
}

function firstSnippet(doc: KnowledgeDoc): string {
  return (
    firstSentence(doc.whenToUse) ||
    firstSentence(doc.body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '')
  );
}

function toKnowledgeHit(
  doc: KnowledgeDoc,
  score: number,
  match: KnowledgeHit['match'],
): KnowledgeHit {
  return {
    uri: doc.uri,
    slug: doc.slug,
    title: doc.title,
    score,
    snippet: firstSnippet(doc),
    match,
  };
}

function searchKnowledgeByKeywordIntersection(query: string, limit: number): KnowledgeHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return searchKnowledgeByWholeString(query, limit);

  const fuse = ensureKnowledgeKeywordFuse();
  const ranked = new Map<
    string,
    {
      doc: KnowledgeDoc;
      matchedTokenCount: number;
      titleTokenCount: number;
      fuseScoreSum: number;
    }
  >();

  for (const token of tokens) {
    for (const result of fuse.search(`'${token}`)) {
      const current = ranked.get(result.item.slug);
      if (current) {
        current.matchedTokenCount++;
        current.fuseScoreSum += result.score ?? 1;
      } else {
        ranked.set(result.item.slug, {
          doc: result.item,
          matchedTokenCount: 1,
          titleTokenCount: tokens.filter((candidate) =>
            queryTokens(result.item.title).includes(candidate),
          ).length,
          fuseScoreSum: result.score ?? 1,
        });
      }
    }
  }

  return [...ranked.values()]
    .sort((a, b) => {
      const aScore =
        a.matchedTokenCount * 2 +
        a.titleTokenCount * 0.08 +
        (1 - a.fuseScoreSum / a.matchedTokenCount);
      const bScore =
        b.matchedTokenCount * 2 +
        b.titleTokenCount * 0.08 +
        (1 - b.fuseScoreSum / b.matchedTokenCount);
      const scoreDelta = bScore - aScore;
      if (scoreDelta !== 0) return scoreDelta;
      return a.doc.slug.localeCompare(b.doc.slug);
    })
    .slice(0, Math.max(1, limit))
    .map((rankedDoc) => {
      const avgFuseScore = rankedDoc.fuseScoreSum / rankedDoc.matchedTokenCount;
      const compositeScore =
        (rankedDoc.matchedTokenCount * 2 + rankedDoc.titleTokenCount * 0.08 + (1 - avgFuseScore)) /
        (tokens.length * 2.08 + 1);
      return toKnowledgeHit(rankedDoc.doc, Number(compositeScore.toFixed(3)), 'keyword');
    });
}

function searchKnowledgeByWholeString(query: string, limit: number): KnowledgeHit[] {
  const q = query.trim();
  if (!q) return [];

  return ensureKnowledgeKeywordFuse()
    .search(q)
    .slice(0, Math.max(1, limit))
    .map((r) =>
      toKnowledgeHit(
        r.item,
        typeof r.score === 'number' ? Number((1 - r.score).toFixed(3)) : 0,
        'whole-string',
      ),
    );
}

function nearestKeywordMatches(query: string, limit: number, broaden = false): KnowledgeHit[] {
  const fallbackQuery = keywordFallbackQuery(query);
  if (!fallbackQuery) return [];

  const nearestMatches = ensureKnowledgeKeywordFuse()
    .search(fallbackQuery)
    .slice(0, Math.min(5, Math.max(3, limit)))
    .map((r) =>
      toKnowledgeHit(
        r.item,
        typeof r.score === 'number' ? Number((1 - r.score).toFixed(3)) : 0,
        'nearest',
      ),
    );

  if (nearestMatches.length > 0 || !broaden) return nearestMatches;

  return ensureKnowledgeBroadNearestFuse()
    .search(query)
    .slice(0, Math.min(5, Math.max(3, limit)))
    .map((r) =>
      toKnowledgeHit(
        r.item,
        typeof r.score === 'number' ? Number((1 - r.score).toFixed(3)) : 0,
        'nearest',
      ),
    );
}

/**
 * Rank knowledge modules by relevance to a free-text query.
 * @returns up to `limit` hits, best first; `score` is 0..1 (higher = better).
 */
export function searchKnowledge(query: string, limit = 5): KnowledgeHit[] {
  const q = (query ?? '').trim();
  if (!q) return [];
  return requireTopHitRead(searchKnowledgeByKeywordIntersection(q, limit));
}

export function searchKnowledgeWithFallback(query: string, limit = 5): KnowledgeSearchResult {
  const resultLimit = Math.max(1, limit);
  // Inspect a runner-up even when limit is 1 so caller truncation cannot manufacture confidence.
  const candidates = searchKnowledge(query, Math.max(2, resultLimit));
  const hits = candidates.slice(0, resultLimit);
  if (hits.length > 0) {
    const body = hasConfidentTopHit(candidates) ? readKnowledgeResource(hits[0].uri) : null;
    return body === null ? { hits } : { hits, topHitBody: capTopHitBody(body) };
  }

  const q = (query ?? '').trim();
  const nearestMatches = nearestKeywordMatches(q, limit, true);

  if (nearestMatches.length === 0) return { hits };
  return {
    hits,
    nearestMatches: requireTopHitRead(nearestMatches),
    note: ZERO_HIT_NEAREST_MATCHES_NOTE,
  };
}

/** Reset cached index/fuse (tests). */
export function _resetKnowledgeSearchCache(): void {
  _knowledgeDocs = null;
  _knowledgeKeywordFuse = null;
  _knowledgeBroadNearestFuse = null;
}
