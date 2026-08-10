import { z } from 'zod';

/** Canonical Pulse sentiment tokens (RepresentationOptions.SentimentType). */
export type SentimentToken =
  | 'SENTIMENT_TYPE_UNSPECIFIED'
  | 'SENTIMENT_TYPE_NONE'
  | 'SENTIMENT_TYPE_UP_IS_GOOD'
  | 'SENTIMENT_TYPE_DOWN_IS_GOOD';

export const sentimentTokenSchema = z.enum([
  'SENTIMENT_TYPE_UNSPECIFIED',
  'SENTIMENT_TYPE_NONE',
  'SENTIMENT_TYPE_UP_IS_GOOD',
  'SENTIMENT_TYPE_DOWN_IS_GOOD',
]);

/** Author-facing display name -> sentiment token. Keys are matched fuzzily to
 *  a request's measure caption/localName; see `matchSentiment`. */
export const sentimentMapSchema = z.record(z.string(), sentimentTokenSchema);
export type SentimentMap = z.infer<typeof sentimentMapSchema>;

/** Max normalized Levenshtein distance accepted as a fuzzy match. Small so only
 *  typos/plurals match; anything looser risks assigning the wrong sentiment. */
const FUZZY_MAX_DISTANCE = 2;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Resolve a measure's sentiment from the map, or `undefined` if no confident
 *  match. Precedence: normalized-exact on caption, then localName; then a
 *  single unambiguous fuzzy match within `FUZZY_MAX_DISTANCE` across both
 *  candidates. Ambiguous or too-far => undefined (never guess). */
export function matchSentiment(
  map: SentimentMap,
  caption: string | undefined,
  localName: string | undefined,
): SentimentToken | undefined {
  const keys = Object.keys(map);
  if (keys.length === 0) return undefined;

  const candidates = [caption, localName]
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .map(normalize);
  if (candidates.length === 0) return undefined;

  const normKeys = keys.map((k) => ({ key: k, norm: normalize(k) }));

  // 1. Normalized-exact, candidate order (caption before localName).
  for (const cand of candidates) {
    const hit = normKeys.find((k) => k.norm === cand);
    if (hit) return map[hit.key];
  }

  // 2. Fuzzy: best single unambiguous match within threshold.
  let best: { token: SentimentToken; dist: number } | undefined;
  let tie = false;
  for (const cand of candidates) {
    for (const k of normKeys) {
      const dist = levenshtein(cand, k.norm);
      if (dist > FUZZY_MAX_DISTANCE) continue;
      if (best === undefined || dist < best.dist) {
        best = { token: map[k.key], dist };
        tie = false;
      } else if (dist === best.dist && map[k.key] !== best.token) {
        tie = true;
      }
    }
  }
  if (best === undefined || tie) return undefined;
  return best.token;
}
