import Fuse from 'fuse.js';
import { join } from 'path';

import { getResourcesRoot, listKnowledgeSlugs, readKnowledgeBySlug } from '../assets.js';

export interface KnowledgeResource {
  uri: string;
  name: string;
  description: string;
  mimeType: 'text/markdown';
}

export function getKnowledgeDir(): string {
  return join(getResourcesRoot(), 'knowledge');
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
  _cache = listKnowledgeSlugs().map((slug) => {
    const content = readKnowledgeBySlug(slug);
    const { name, description } =
      content !== null ? extractMeta(content, slug) : { name: slug, description: '' };
    return { uri: `expertise://tableau/${slug}`, name, description, mimeType: 'text/markdown' };
  });
  return _cache;
}

export function readKnowledgeResource(uri: string): string | null {
  const PREFIX = 'expertise://tableau/';
  if (!uri.startsWith(PREFIX)) return null;
  const slug = uri.slice(PREFIX.length);
  if (!slug || slug.includes('..') || slug.includes('\\') || slug.startsWith('/')) return null;

  return readKnowledgeBySlug(slug);
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
let _knowledgeFuse: Fuse<KnowledgeDoc> | null = null;
let _knowledgeKeywordFuse: Fuse<KnowledgeDoc> | null = null;
let _knowledgeFallbackFuse: Fuse<KnowledgeDoc> | null = null;
let _knowledgeBroadNearestFuse: Fuse<KnowledgeDoc> | null = null;

const MAX_WHOLE_STRING_QUERY_LENGTH = 32;

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

const LONG_QUERY_STOPWORDS = new Set([
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

const LONG_QUERY_TOOL_JARGON = new Set([
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

  docs.sort((a, b) => a.slug.localeCompare(b.slug));
  _knowledgeDocs = docs;
  return docs;
}

function ensureKnowledgeFuse(): Fuse<KnowledgeDoc> {
  if (_knowledgeFuse) return _knowledgeFuse;
  _knowledgeFuse = new Fuse(buildKnowledgeIndex(), {
    keys: knowledgeSearchKeys,
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  });
  return _knowledgeFuse;
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
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  nearestMatches?: KnowledgeHit[];
  note?: string;
}

export const ZERO_HIT_NEAREST_MATCHES_NOTE =
  'zero exact matches — nearest by keyword below; rephrase around the concept (shorter, no tool names) for better results.';

function ensureKnowledgeFallbackFuse(): Fuse<KnowledgeDoc> {
  if (_knowledgeFallbackFuse) return _knowledgeFallbackFuse;
  _knowledgeFallbackFuse = new Fuse(buildKnowledgeIndex(), {
    keys: knowledgeSearchKeys,
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    useExtendedSearch: true,
  });
  return _knowledgeFallbackFuse;
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
  return (query.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [])
    .filter((word) => word.length > 2)
    .join(' | ');
}

function longQueryTokens(query: string): string[] {
  const tokens = (query.match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [])
    .map((word) => word.toLowerCase())
    .filter(
      (word) =>
        word.length > 2 && !LONG_QUERY_STOPWORDS.has(word) && !LONG_QUERY_TOOL_JARGON.has(word),
    );
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

function searchKnowledgeWholeString(query: string, limit: number): KnowledgeHit[] {
  return ensureKnowledgeFuse()
    .search(query)
    .slice(0, Math.max(1, limit))
    .map((r) =>
      toKnowledgeHit(
        r.item,
        typeof r.score === 'number' ? Number((1 - r.score).toFixed(3)) : 0,
        'whole-string',
      ),
    );
}

function searchKnowledgeByKeywordIntersection(query: string, limit: number): KnowledgeHit[] {
  const tokens = longQueryTokens(query);
  if (tokens.length === 0) return [];

  const fuse = ensureKnowledgeKeywordFuse();
  const ranked = new Map<
    string,
    { doc: KnowledgeDoc; matchedTokenCount: number; fuseScoreSum: number }
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
          fuseScoreSum: result.score ?? 1,
        });
      }
    }
  }

  return [...ranked.values()]
    .sort((a, b) => {
      const tokenCountDelta = b.matchedTokenCount - a.matchedTokenCount;
      if (tokenCountDelta !== 0) return tokenCountDelta;
      const scoreDelta = a.fuseScoreSum - b.fuseScoreSum;
      if (scoreDelta !== 0) return scoreDelta;
      return a.doc.slug.localeCompare(b.doc.slug);
    })
    .slice(0, Math.max(1, limit))
    .map((rankedDoc) => {
      const avgFuseScore = rankedDoc.fuseScoreSum / rankedDoc.matchedTokenCount;
      const compositeScore =
        (rankedDoc.matchedTokenCount * 2 + (1 - avgFuseScore)) / (tokens.length * 2 + 1);
      return toKnowledgeHit(rankedDoc.doc, Number(compositeScore.toFixed(3)), 'keyword');
    });
}

function nearestKeywordMatches(query: string, limit: number, broaden = false): KnowledgeHit[] {
  const fallbackQuery = keywordFallbackQuery(query);
  if (!fallbackQuery) return [];

  const nearestMatches = ensureKnowledgeFallbackFuse()
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
  if (q.length <= MAX_WHOLE_STRING_QUERY_LENGTH) return searchKnowledgeWholeString(q, limit);
  return searchKnowledgeByKeywordIntersection(q, limit);
}

export function searchKnowledgeWithFallback(query: string, limit = 5): KnowledgeSearchResult {
  const hits = searchKnowledge(query, limit);
  if (hits.length > 0) return { hits };

  const q = (query ?? '').trim();
  const nearestMatches = nearestKeywordMatches(q, limit, q.length > MAX_WHOLE_STRING_QUERY_LENGTH);

  if (nearestMatches.length === 0) return { hits };
  return { hits, nearestMatches, note: ZERO_HIT_NEAREST_MATCHES_NOTE };
}

/** Reset cached index/fuse (tests). */
export function _resetKnowledgeSearchCache(): void {
  _knowledgeDocs = null;
  _knowledgeFuse = null;
  _knowledgeKeywordFuse = null;
  _knowledgeFallbackFuse = null;
  _knowledgeBroadNearestFuse = null;
}
