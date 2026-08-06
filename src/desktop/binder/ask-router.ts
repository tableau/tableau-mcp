// src/desktop/binder/ask-router.ts
//
// The route layer's SELECTOR (Slice B, ported from a2td src/binder/ask-router.ts).
// SELECTOR-ONLY by design: it turns a masked ask into the single eligible template the
// binder's own model-free matcher would pick, and NOTHING more. It never executes, never
// binds fields, never touches a live schema — the a2td tier-ladder / validateBinding
// disposer (routeAsk) is deliberately NOT ported (that is the binder's job, not the route
// layer's). `route-spec.ts` reuses this exact seam for schema-free ask-SHAPE detection so
// the route layer never re-derives classification.
//
// LOCKSTEP MIRROR: this file imports NOTHING from `./classify.ts` (the hash-gated
// lockstep-core classifier stays byte-untouched). The matcher primitives below
// (phraseIndexInAsk / keywordScore / familyNativeKeywords / selectEligible) and the
// CHART_NOUN_KEYWORDS table are hand-maintained copies of classify.ts's. ask-router.test.ts
// regex-extracts BOTH CHART_NOUN_KEYWORDS tables and asserts SET EQUALITY, so any growth in
// classify.ts must be mirrored here or the parity test goes RED.

import type { RuntimeTemplateDescriptor } from './manifest-types.js';

type TemplateManifest = RuntimeTemplateDescriptor;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PLURALIZABLE CHART-NOUN TOKENS (parity with classify.ts): a keyword phrase earns a
 * trailing-`s` tolerance in phraseIndexInAsk ONLY when its final token is a chart-type
 * noun ("bars"↔"bar", "maps"↔"map"), never for a non-noun keyword ("trend"↛"trends").
 */
const PLURALIZABLE_CHART_NOUNS: ReadonlySet<string> = new Set([
  'bar',
  'column',
  'map',
  'treemap',
  'pie',
  'donut',
]);

/**
 * Index of the first whole-token occurrence of `phrase` in `ask`, else -1. Hyphen in a
 * keyword matches hyphen OR whitespace in the ask ("over-time" ↔ "over time"); a
 * chart-noun final token gets an optional trailing `s`. Reimplemented from classify.ts.
 */
function phraseIndexInAsk(ask: string, phrase: string): number {
  const p = phrase.toLowerCase().trim();
  if (!p) return -1;
  const body = escapeRegex(p).replace(/-/g, '[\\s-]+');
  const tokens = p.split(/[^a-z0-9]+/).filter(Boolean);
  const finalToken = tokens[tokens.length - 1];
  const pluralSuffix = finalToken && PLURALIZABLE_CHART_NOUNS.has(finalToken) ? 's?' : '';
  const re = new RegExp(`(^|[^a-z0-9])${body}${pluralSuffix}([^a-z0-9]|$)`);
  const match = re.exec(ask.toLowerCase());
  return match ? match.index : -1;
}

function keywordScore(ask: string, keywords: string[]): number {
  let n = 0;
  for (const kw of keywords) if (phraseIndexInAsk(ask, kw) >= 0) n++;
  return n;
}

function matchedKeywords(ask: string, keywords: string[]): string[] {
  return keywords.filter((kw) => phraseIndexInAsk(ask, kw) >= 0);
}

/**
 * FAMILY-NATIVE vocabulary over the ELIGIBLE pool (parity with classify.ts): a keyword is
 * native to a family when carried by a STRICT MAJORITY of that family's fast_path_eligible
 * templates (a single-member family ⇒ all its keywords). Separates a family's defining
 * vocabulary from a keyword a lone member merely borrowed.
 */
function familyNativeKeywords(family: string, manifests: TemplateManifest[]): Set<string> {
  const sets: Set<string>[] = [];
  for (const m of manifests) {
    if (!m.fast_path_eligible || m.family !== family) continue;
    sets.push(new Set(m.intent_keywords.map((k) => k.toLowerCase())));
  }
  const counts = new Map<string, number>();
  for (const s of sets) for (const k of s) counts.set(k, (counts.get(k) ?? 0) + 1);
  const threshold = sets.length / 2;
  const native = new Set<string>();
  for (const [k, c] of counts) if (c > threshold) native.add(k);
  return native;
}

/**
 * Distinctive chart-shape nouns (lowercased intent_keyword tokens) — a match is a
 * deterministic chart-TYPE selector, exempting a lone winner from the family-native guard.
 * VERBATIM MIRROR of classify.ts's CHART_NOUN_KEYWORDS, kept in lockstep BY HAND because
 * this file imports NOTHING from classify.ts. ask-router.test.ts regex-extracts BOTH tables
 * and asserts SET EQUALITY, so every classify.ts growth must be mirrored here.
 */
const CHART_NOUN_KEYWORDS: ReadonlySet<string> = new Set([
  'bar',
  'sorted-bar',
  'column',
  'sorted-column',
  'vertical-bar',
  'stacked-bar',
  'treemap',
  'pie',
  'donut',
  'line',
  'trend',
  'gantt',
  'histogram',
  'bullet',
  'funnel',
  'slope',
  'slope-chart',
  'slope-graph',
  'box-plot',
  'boxplot',
  'box-and-whisker',
  'over-time',
  'timeline',
  'arrow-chart',
  'over-under-arrow',
  'bar-code',
  'strip-plot',
  'dot-strip',
  'waterfall',
  'choropleth',
  'filled-map',
  'region-map',
]);

function wonChartNoun(maskedAsk: string, keywords: string[]): boolean {
  return matchedKeywords(maskedAsk, keywords).some((kw) =>
    CHART_NOUN_KEYWORDS.has(kw.toLowerCase()),
  );
}

/**
 * FAMILY-LEVEL spatial intent guard vocabulary — hand-mirrored from classify.ts
 * (this file must not import the classifier); a parity test enforces set equality.
 * See classify.ts for the full rationale (W-23447710, Cluster A selection half).
 */
const SPATIAL_INTENT_ALIASES: ReadonlySet<string> = new Set([
  'geo',
  'geographic',
  'geographical',
  'geographically',
  'coordinate',
  'coordinates',
  'gps',
  'lat/long',
  'lat/lon',
  'lat-long',
  'lat-lon',
]);

function spatialIntentPhrases(manifests: TemplateManifest[]): Set<string> {
  const phrases = new Set<string>(SPATIAL_INTENT_ALIASES);
  for (const m of manifests) {
    if (m.family !== 'spatial') continue;
    for (const kw of m.intent_keywords) phrases.add(kw.toLowerCase());
  }
  return phrases;
}

/** Lat+lon named together is coordinate intent even without a map noun. */
function hasCoordinatePairIntent(rawAsk: string): boolean {
  const hasLat = phraseIndexInAsk(rawAsk, 'latitude') >= 0 || phraseIndexInAsk(rawAsk, 'lat') >= 0;
  const hasLon =
    phraseIndexInAsk(rawAsk, 'longitude') >= 0 ||
    phraseIndexInAsk(rawAsk, 'lon') >= 0 ||
    phraseIndexInAsk(rawAsk, 'lng') >= 0 ||
    phraseIndexInAsk(rawAsk, 'long') >= 0;
  return hasLat && hasLon;
}

function askCarriesSpatialIntent(
  rawAsk: string,
  maskedAsk: string,
  manifests: TemplateManifest[],
): boolean {
  for (const phrase of spatialIntentPhrases(manifests)) {
    if (phraseIndexInAsk(maskedAsk, phrase) >= 0) return true;
  }
  return hasCoordinatePairIntent(rawAsk);
}

/**
 * Bare point-mark words that disambiguate a generic spatial "map" tie toward a
 * symbol map — hand-mirrored from classify.ts's SYMBOL_MAP_MARK_CUES (this file
 * must not import the classifier); a parity test enforces set equality.
 */
const SYMBOL_MAP_MARK_CUES: readonly string[] = [
  'dot',
  'dots',
  'bubble',
  'bubbles',
  'pin',
  'pins',
  'point',
  'points',
  'circle',
  'circles',
  'marker',
  'markers',
];

function askHasSymbolMapMarkCue(maskedAsk: string): boolean {
  return SYMBOL_MAP_MARK_CUES.some((cue) => phraseIndexInAsk(maskedAsk, cue) >= 0);
}

/**
 * Subset of SPATIAL_INTENT_ALIASES that name a coordinate map WITHOUT naming actual
 * coordinates ("geographic" describes intent, not a lat/lon pair) — mirrors
 * classify.ts's NON_COORDINATE_SPATIAL_ALIASES so the mark-cue tie-break below stays
 * in lockstep with selectWithinFamily's ordering fix.
 */
const NON_COORDINATE_SPATIAL_ALIASES: ReadonlySet<string> = new Set([
  'geo',
  'geographic',
  'geographical',
  'geographically',
]);

// Coordinate-pair half runs on the RAW ask deliberately (parity with classify.ts):
// this file has no schema to mask against here either, but callers that DO carry a
// live ask (route-spec.ts, etc.) may pass a masked ask as `maskedAsk` while the raw
// ask is available separately — keep the same two-string contract as classify.ts so
// a future caller with real field masking can't silently reintroduce the bug where
// masking blanks literal "latitude"/"longitude" field names and kills this brake.
function askHasExplicitCoordinateIntent(rawAsk: string, maskedAsk: string): boolean {
  for (const alias of SPATIAL_INTENT_ALIASES) {
    if (NON_COORDINATE_SPATIAL_ALIASES.has(alias)) continue;
    if (phraseIndexInAsk(maskedAsk, alias) >= 0) return true;
  }
  return hasCoordinatePairIntent(rawAsk);
}

const GENERATED_SYMBOL_MAP_TEMPLATE = 'spatial-symbol-map';
const LATLON_SYMBOL_MAP_TEMPLATE = 'spatial-symbol-map-latlon';

/**
 * BIND-path template selection over the ELIGIBLE pool. Fail-closed: bind only on a UNIQUE
 * keyword-argmax winner that is DECISIVE (won a family-native keyword OR a distinctive chart
 * noun). Any keyword-score tie ⇒ null. `selectEligible` enforces the `fast_path_eligible`
 * stamp, so a route can never point at unproven supply.
 *
 * The route layer's ONLY consult of the binder's matcher: `route-spec.ts` calls this for
 * schema-free ask-SHAPE detection and must never re-derive classification.
 */
export function selectEligible(
  maskedAsk: string,
  manifests: TemplateManifest[],
  rawAsk = maskedAsk,
): TemplateManifest | null {
  const scored = manifests
    .filter((m) => m.fast_path_eligible && m.template !== LATLON_SYMBOL_MAP_TEMPLATE)
    .map((m) => ({ m, score: keywordScore(maskedAsk, m.intent_keywords) }))
    .filter((x) => x.score > 0);
  if (scored.length === 0) return null;
  const maxScore = scored.reduce((mx, s) => Math.max(mx, s.score), 0);
  const top = scored.filter((s) => s.score === maxScore);
  if (top.length !== 1) {
    // SPATIAL mark-cue tie-break, mirroring classify.ts's selectWithinFamily ordering
    // fix: a bare point-mark word ("dots", "bubbles", ...) is the missing
    // discriminator between filled regions and symbols even when another eligible
    // template's borrowed keyword ties the score. Any other tie still fails closed
    // exactly as before, so this can only ADD an accept, never a wrong bind. This
    // layer is schema-free (never touches fields), so it has no equivalent of
    // classify.ts's "ask matched a measure" guard — that guard exists to stop
    // classify.ts from filling a required slot from thin air, which this selector
    // never does in the first place (it names a template, nothing more).
    const symbolMap = top.find((t) => t.m.template === GENERATED_SYMBOL_MAP_TEMPLATE);
    if (
      symbolMap &&
      top.some((t) => t.m.family === 'spatial') &&
      askHasSymbolMapMarkCue(maskedAsk) &&
      !askHasExplicitCoordinateIntent(rawAsk, maskedAsk)
    ) {
      return symbolMap.m;
    }
    return null; // fail-closed on any other tie
  }
  const m = top[0].m;
  // Family guard (W-23447710): a spatial-intent ask never binds a non-spatial winner.
  if (m.family !== 'spatial' && askCarriesSpatialIntent(rawAsk, maskedAsk, manifests)) return null;
  const native = familyNativeKeywords(m.family, manifests);
  const won = matchedKeywords(maskedAsk, m.intent_keywords);
  const decisive =
    won.some((kw) => native.has(kw.toLowerCase())) || wonChartNoun(maskedAsk, m.intent_keywords);
  return decisive ? m : null;
}
