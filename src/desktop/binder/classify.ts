// src/binder/classify.ts
//
// Tier-1 fast-path binder — no-LLM classification + LLM-input construction
// (design doc §3.3, §3.5).
//
// `classifyNoLlm` is the zero-latency path: it picks a single clearly-winning
// `fast_path_eligible` template by keyword match, then does role-greedy field
// assignment (measures → quantitative slots, dimensions → categorical/temporal
// slots) from the ask, producing a `{template, bindings}` the gate can verify.
// It fails CLOSED — a tie, a zero-score ask, or any unfilled required slot
// returns `null`, so the orchestrator falls through to the LLM propose path.
//
// `buildLlmInput` assembles the compact, constrained-JSON contract for the
// small-LLM call: only the fast-path candidates that survived keyword ranking
// (Fuse over intent_keywords when no exact hit), each with its BINDABLE slots
// only, plus the field schema. Everything the model could get wrong (derivation,
// aggregation, instance syntax) is outside its output surface.

import Fuse from 'fuse.js';

import { calcForcedSlotIds } from './calc-derivation.js';
import type { Derivation, SlotKind, TemplateManifest } from './manifest-types.js';

/**
 * SCHEMA SHAPES + `bareName`, inlined so this file stays import-pure — it severs the
 * divergent `./schema-summary.js` edge (the same convergence move calc-derivation.ts
 * makes) so the classifier depends only on `./manifest-types.js` + `./calc-derivation.js`
 * and a byte-identical copy resolves entirely within the shared lockstep-core set.
 * These MIRROR the schema module's exported `SchemaField`/`SchemaSummary` structurally;
 * the PRODUCER (`summarizeSchema`) still lives there — only the read-only shapes the
 * classifier consumes are declared here.
 */
interface SchemaField {
  name: string; // friendly name: caption ?? bare column name
  caption?: string;
  columnName: string; // bracketed local name, e.g. "[Region]"
  role: 'dimension' | 'measure';
  type: string; // "quantitative" | "nominal" | "ordinal" | ...
  datatype: string; // "string" | "real" | "integer" | "date" | "datetime" | ...
  datasource: string;
  isAggregated: boolean;
  column_ref: string; // straight from listAvailableFields, e.g. "[Superstore].[sum:Sales:qk]"
}

interface SchemaSummary {
  /** The primary datasource — substituted for {{DATASOURCE}} and the expected home of every bound field. */
  datasource: string;
  fields: SchemaField[];
}

/** Strip surrounding brackets from a Tableau field name: "[Region]" -> "Region". */
function bareName(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

export interface LlmProposeInput {
  ask: string;
  candidate_templates: Array<{
    template: string;
    description: string;
    intent_keywords: string[];
    // Negative routing guidance (chart-selection anti-patterns) so the proposing
    // model can WEIGH the caution before committing to this template. Absent ⇒ no
    // encoded caution. Never a blocker — purely advisory context for the model.
    avoid_when?: string[];
    // bindable only; `derivation` is the template's DEFAULT for the slot, exposed
    // so the model overrides in its output ONLY when the ask asks for something
    // different (see PROPOSAL_OUTPUT_SCHEMA's derivation instruction line).
    slots: Array<{
      slot_id: string;
      role: string[];
      kind: SlotKind;
      required: boolean;
      derivation?: Derivation;
    }>;
  }>;
  fields: Array<{ name: string; role: 'dimension' | 'measure'; type: string; datatype: string }>;
  /**
   * FIELD-NARROWING signal (stage 2B, adjudicated attack 1): present ONLY when
   * `fields` was capped — `count` is how many relevant-but-lower-ranked fields
   * were withheld, and `note` tells the caller to re-query with a field-name hint
   * if the field it needs is not in `fields`. Absent ⇒ every schema field is here.
   */
  more_available?: { count: number; note: string };
}

/** Default field cap for the propose prompt (stage 2B). See buildLlmInput opts. */
export const DEFAULT_MAX_FIELDS = 20;

/**
 * Hard cap on the schema size the no-LLM classifier / propose-payload builder will
 * process (M10 Finding 3). `maskFieldNames` + `matchFieldsInAsk` (classifyNoLlm) and
 * `narrowFields` (buildLlmInput) each run ONE regex PER schema field; a synthetic
 * ~50,000-field datasource costs ~2.9s of synchronous event-loop block per call — an
 * unbounded per-call CPU DoS. Over this cap the classifier FAILS CLOSED (returns null —
 * never a truncated subset, which would be a silent wrong answer), and bindTemplate
 * escalates `schema-too-large`. 5000 is comfortably above any real Tableau datasource
 * (hundreds of fields) yet bounds the worst-case loop to well under ~0.3s.
 */
export const MAX_CLASSIFIABLE_FIELDS = 5000;

/**
 * Explicit aggregation words → canonical short forms, longest/most-specific
 * phrases first so "distinct count" wins over "count". Kept deliberately small
 * and conservative: only words that unambiguously name an aggregation.
 */
const AGGREGATION_WORDS: ReadonlyArray<{ phrase: string; deriv: Derivation }> = [
  { phrase: 'distinct count', deriv: 'cntd' },
  { phrase: 'count distinct', deriv: 'cntd' },
  { phrase: 'average', deriv: 'avg' },
  { phrase: 'avg', deriv: 'avg' },
  { phrase: 'median', deriv: 'median' },
  { phrase: 'minimum', deriv: 'min' },
  { phrase: 'min', deriv: 'min' },
  { phrase: 'maximum', deriv: 'max' },
  { phrase: 'max', deriv: 'max' },
  { phrase: 'count', deriv: 'cnt' },
];

/**
 * Detect a single explicit aggregation word in the ask → its short form, else
 * null. The earliest-occurring phrase wins; ties keep the more specific phrase
 * (listed first), so "distinct count" resolves to cntd rather than cnt. Fails
 * closed: no recognized word → null (no override).
 */
function detectAggregationOverride(ask: string): Derivation | null {
  let best: { deriv: Derivation; index: number } | null = null;
  for (const { phrase, deriv } of AGGREGATION_WORDS) {
    const idx = phraseIndexInAsk(ask, phrase);
    if (idx < 0) continue;
    if (best === null || idx < best.index) best = { deriv, index: idx };
  }
  return best ? best.deriv : null;
}

const TEMPORAL_DATATYPES: ReadonlySet<string> = new Set(['date', 'datetime']);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PLURALIZABLE CHART-NOUN TOKENS (FS4b token-class guard). Singular chart-type
 * nouns whose natural English plural (`bar`→`bars`, `column`→`columns`, `map`→
 * `maps`) an ask commonly uses ("Stacked bars", "Maps"). A keyword phrase earns a
 * trailing-`s` tolerance in `phraseIndexInAsk` ONLY when its FINAL token is in this
 * set, so the tolerance stays scoped to deterministic chart-type nouns and never
 * broadens matching for a non-noun keyword (e.g. "trend"→"trends" stays a miss).
 * A multi-token compound ("stacked-bar") pluralizes on its final token only. Kept
 * as bare tokens (not the phrase set CHART_NOUN_KEYWORDS) because the plural sits on
 * the final token — "stacked-bar"/"sorted-bar"/"vertical-bar" all pluralize via "bar".
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
 * Index of the first whole-token occurrence of `phrase` in `ask`, else -1.
 * Boundaries are non-alphanumeric so "bar" matches "bar chart" but not "sidebar".
 * A HYPHEN in a keyword matches a hyphen OR whitespace in the ask, so a compound
 * keyword written with hyphens ("stacked-bar", "over-time", "vertical-bar") also
 * matches the natural spaced form a user types ("stacked bar", "over time"). This
 * lets a distinctive multi-token chart noun keep its keyword-match specificity when
 * the ask spells it with a space — the classifier stays no-LLM and deterministic.
 *
 * PLURAL TOLERANCE (FS4b): when the phrase's FINAL token is a chart noun
 * (`PLURALIZABLE_CHART_NOUNS`), an optional trailing `s` is allowed on that token so
 * "bars"/"columns"/"maps"/"stacked bars" match "bar"/"column"/"map"/"stacked-bar".
 * Scoped to chart nouns only — no stemming, no mid-token change, no broadening of
 * non-noun keywords; the singular still matches unchanged.
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

/** Count of a template's intent_keywords that appear as whole tokens in the ask. */
function keywordScore(ask: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) if (phraseIndexInAsk(ask, kw) >= 0) score++;
  return score;
}

/**
 * High-frequency filler dropped before avoid_when token overlap so a caution
 * never fires on generic connective/qualifier words. Deliberately conservative:
 * it must NOT contain any word that carries the anti-pattern signal itself
 * (e.g. "precise", "comparison", "time", "angle").
 */
const AVOID_WHEN_STOPWORDS: ReadonlySet<string> = new Set([
  'when',
  'with',
  'that',
  'this',
  'from',
  'into',
  'than',
  'then',
  'have',
  'will',
  'would',
  'should',
  'could',
  'must',
  'them',
  'they',
  'their',
  'there',
  'here',
  'what',
  'which',
  'while',
  'where',
  'also',
  'only',
  'just',
  'very',
  'much',
  'many',
  'more',
  'most',
  'less',
  'some',
  'each',
  'both',
  'either',
  'other',
  'onto',
  'over',
  'under',
  'about',
  'instead',
  'prefer',
  'avoid',
  'usually',
  'never',
  'always',
  'being',
  'because',
  'context',
  'chart',
  'charts',
  'data',
  'using',
  'used',
  'uses',
  'make',
  'makes',
  'made',
  'reads',
  'read',
  'render',
  'renders',
  'become',
  'becomes',
]);

/**
 * Light inflectional normalizer for whole-token overlap: lowercases and strips
 * one common suffix so morphological variants collapse (precisely→precise,
 * compared→compar, sorted→sort). Not a real stemmer — just enough for the
 * "simple token overlap" the avoid_when caution needs.
 */
function normalizeToken(raw: string): string {
  let s = raw.toLowerCase();
  if (s.endsWith('ly') && s.length > 4) s = s.slice(0, -2);
  if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('es') && s.length > 5) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 4) s = s.slice(0, -1);
  return s;
}

/** Normalized content tokens (len>=4, non-stopword) of a phrase, for overlap. */
function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || AVOID_WHEN_STOPWORDS.has(raw)) continue;
    const n = normalizeToken(raw);
    if (n.length >= 3) out.add(n);
  }
  return out;
}

/**
 * Return the avoid_when ENTRIES whose content terms overlap the ask (simple
 * whole-token overlap after light normalization). Terms that positively SELECT
 * the template — its intent_keywords — are excluded so the chart's own name
 * (e.g. "pie") can never trip its own caution. Empty when avoid_when is absent
 * or no scenario term appears in the ask.
 *
 * Advisory only: a non-empty result DEMOTES the no-LLM shortcut (classifyNoLlm)
 * or attaches WARNINGS on a bound result (validateBinding) — it never blocks.
 */
export function matchAvoidWhen(
  ask: string,
  avoidWhen: string[] | undefined,
  intentKeywords: string[] = [],
): string[] {
  if (!avoidWhen || avoidWhen.length === 0) return [];
  const askTerms = contentTokens(ask);
  if (askTerms.size === 0) return [];
  const excluded = new Set<string>();
  for (const kw of intentKeywords) for (const t of contentTokens(kw)) excluded.add(t);
  const matched: string[] = [];
  for (const entry of avoidWhen) {
    for (const t of contentTokens(entry)) {
      if (!excluded.has(t) && askTerms.has(t)) {
        matched.push(entry);
        break;
      }
    }
  }
  return matched;
}

/**
 * Hazard codes that DEMOTE the no-LLM shortcut unconditionally (W59). avoid_when
 * is ask-conditioned; these hazards are DATA-conditioned — the risk (e.g. calcs
 * that SPLIT a specific compound-string shape out of a bound field) is invisible
 * in any natural ask, so the zero-model path can never rule it out. Demote-only:
 * the template stays fully bindable via the propose leg, where the model sees the
 * hazard detail and judges the actual schema against it.
 */
const DETERMINISTIC_PATH_BLOCKING_HAZARDS: ReadonlySet<string> = new Set(['compound-string-parse']);

/** True when the manifest carries a hazard the no-LLM path must not bind through. */
export function hasDeterministicPathBlockingHazard(
  manifest: Pick<TemplateManifest, 'hazards'>,
): boolean {
  return (manifest.hazards ?? []).some((h) => DETERMINISTIC_PATH_BLOCKING_HAZARDS.has(h.code));
}

/** The intent_keywords (original case) that appear as whole tokens in `ask`. */
function matchedKeywords(ask: string, keywords: string[]): string[] {
  return keywords.filter((kw) => phraseIndexInAsk(ask, kw) >= 0);
}

/**
 * Keyword-match SPECIFICITY for the intra-family tiebreak: a multi-token /
 * hyphenated keyword ("over-time", "column-bar") is more specific than a single
 * generic token ("bar"), so a candidate matched on a longer/compound keyword
 * outranks one matched only on a bare token. Score = (max whole-word token count
 * among the matched keywords) with the matched keyword's char length as the
 * within-count tiebreak. 0 when nothing matched.
 */
function keywordSpecificity(ask: string, keywords: string[]): number {
  let best = 0;
  for (const kw of matchedKeywords(ask, keywords)) {
    const tokens = kw.split(/[^a-z0-9]+/i).filter(Boolean).length;
    const s = tokens * 1000 + kw.length;
    if (s > best) best = s;
  }
  return best;
}

/**
 * DISTINCTIVE CHART-SHAPE / ORIENTATION nouns (lowercased intent_keyword tokens).
 * Each names a specific chart TYPE, so a match is a DETERMINISTIC type selector —
 * never a "borrowed" cross-family keyword. Two uses in selectWithinFamily:
 *
 *  (1) LONE-WINNER EXEMPTION — a lone keyword winner that won on a chart noun binds
 *      even when that noun is not family-native by strict majority. This is the
 *      sibling-scaling fix: stamping an eligible sibling (a second "ranking" bar/
 *      column, a second "part-to-whole" stacked-bar/treemap/pie) drops a distinctive
 *      noun like "bar"/"column"/"pie" BELOW the majority threshold, which must NOT
 *      demote an otherwise clear one-shot ask to propose.
 *
 *  (2) CROSS-FAMILY TIE-BREAK — a keyword tie that spans families resolves to the
 *      strictly-most-specific chart noun ("stacked bar" beats a generic "bar" →
 *      part-to-whole, not ranking); with no unique chart-noun winner it stays
 *      fail-closed (propose), so genuinely ambiguous asks are unaffected.
 *
 * A keyword NOT in this table (e.g. a family name a template merely borrowed) is
 * still governed by the family-native guard / fail-closed rules — the guard is not
 * weakened. Grow this table as new distinct-shape templates are stamped eligible.
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
  // 2026-07-06 growth (per the table's own contract — grow as new distinct-shape
  // templates are stamped eligible): gantt-task-rollup-chart's stamp made time-series
  // a TWO-member eligible family, collapsing strict-majority nativity for trend-line's
  // vocabulary ("line chart of X over Y" classified null — the exact sibling-scaling
  // regression this table exists to prevent). Each noun below deterministically names
  // a chart type and equals a real intent_keyword of its (stamped or imminently
  // stamped, evidence-earned 2026-07-06) template: 'line' (trend-line-chart),
  // 'gantt' (gantt-task-rollup-chart), 'histogram' (distribution-histogram),
  // 'bullet' (quota-attainment-bullet), 'funnel' (funnel-chart),
  // 'slope' + 'slope-chart' + 'slope-graph' (slope-chart),
  // 'box-plot' + 'boxplot' + 'box-and-whisker' (box-plot-chart).
  'line',
  // 'trend' rides the same growth: carried ONLY by trend-line-chart and a
  // deterministic type selector in practice ("trend of X" names a line chart);
  // without it every noun-less trend ask ("trend over time by month") demotes to
  // propose the moment the family gains a second member. Pattern PHRASES
  // ('over-time', 'time-series') stay out — nouns only; the ask-router lane
  // (W36) is the successor mechanism for phrase-level routing.
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
  // 'over-time' is the one PHRASE-form deterministic selector admitted: carried
  // solely by trend-line-chart, and "X over time" names a line chart as surely as
  // the noun does. Lone-winner is the only path this table gates; if a second
  // time-series template ever carries 'over-time', the TIE path's keyword-
  // specificity ranking (multi-token 'sales-over-time' &c.) governs instead, so
  // admitting it cannot create a cross-template flip later.
  'over-time',
  // 'timeline' rides the same lone-winner contract as 'over-time': it is a
  // deterministic time-axis chart noun carried by EXACTLY ONE fast-path-eligible
  // template — trend-line-chart — so "timeline of X" names a line chart. Without
  // it a noun-less timeline ask ("Timeline of Sales using Order Date") demotes to
  // propose now that time-series is a TWO-member eligible family (trend-line-chart +
  // gantt-task-rollup-chart) and strict-majority nativity has collapsed. Admitting
  // it is safe because NO eligible template collides on it: gantt-task-rollup-chart's
  // eligible intent_keywords are gantt-task-rollup / task-rollup / gantt-rollup /
  // one-bar-per-task / gantt / task-schedule — no 'timeline'; the timeline-ish gantt
  // templates (gantt-timeline-chart, gantt-chart) are NOT fast_path_eligible and
  // classifyNoLlm ignores them. Lone-winner is the only path this admits; if a second
  // eligible time-series template ever carries 'timeline', the TIE path's chart-noun
  // specificity ranking governs, so admitting it cannot create a cross-template flip.
  'timeline',
  // Second growth event same night: the 13th-15th stamps made deviation
  // (quota joins ww-ou-arrow) and distribution (box-plot joins bar-code)
  // two-member families, collapsing nativity for the incumbent members'
  // vocabulary — "over-under arrow chart of Sales" and "bar-code strip of X"
  // classified null (live-caught by the drift guard). Each noun below is a
  // deterministic type selector carried by exactly one template:
  // 'arrow-chart' + 'over-under-arrow' (ww-ou-arrow),
  // 'bar-code' + 'strip-plot' + 'dot-strip' (distribution-bar-code-chart).
  'arrow-chart',
  'over-under-arrow',
  'bar-code',
  'strip-plot',
  'dot-strip',
  // Third growth event (W59): the 2026-07-06 stamp wave's remaining fallout —
  // part-to-whole-waterfall and spatial-choropleth-map shipped stamped but their
  // nouns were never admitted, so both lead exec-demo asks ("waterfall of Profit
  // by Sub-Category", "filled map of Profit by State/Province") demoted to propose
  // (live-caught by the W59 proof-value spike). Each noun below is carried by
  // exactly ONE stamped template (carrier-uniqueness checked across all bundled
  // manifests; the generic 'map' stays OUT — dual-carrier with spatial-symbol-map):
  // 'waterfall' (part-to-whole-waterfall),
  // 'choropleth' + 'filled-map' + 'region-map' (spatial-choropleth-map).
  'waterfall',
  'choropleth',
  'filled-map',
  'region-map',
]);

/** True when at least one ask-matched keyword is a distinctive chart noun. */
function wonChartNoun(ask: string, keywords: string[]): boolean {
  return matchedKeywords(ask, keywords).some((kw) => CHART_NOUN_KEYWORDS.has(kw.toLowerCase()));
}

/**
 * Max keyword specificity among the ask-matched keywords that are CHART NOUNS (0
 * when none matched). Same specificity scale as `keywordSpecificity` (token count
 * dominates, char length breaks within-count ties) but restricted to chart nouns,
 * so the cross-family tie-break can only ever fire on a deterministic chart-type
 * token — a borrowed non-chart keyword scores 0 here and stays fail-closed.
 */
function chartNounSpecificity(ask: string, keywords: string[]): number {
  let best = 0;
  for (const kw of matchedKeywords(ask, keywords)) {
    if (!CHART_NOUN_KEYWORDS.has(kw.toLowerCase())) continue;
    const tokens = kw.split(/[^a-z0-9]+/i).filter(Boolean).length;
    const s = tokens * 1000 + kw.length;
    if (s > best) best = s;
  }
  return best;
}

/**
 * FAMILY-NATIVE vocabulary (stage 2b sole-wrong-matcher guard). Derived from the
 * family's OWN fast-path-eligible manifests: a keyword is native to `family` when
 * it is carried by a STRICT MAJORITY of that family's eligible templates (for a
 * single-template family that is all of its keywords). This separates a family's
 * shared, defining vocabulary (its primary + consistent secondaries, present in
 * most/all members) from a keyword only ONE member carries — e.g. a cross-family
 * keyword a single template BORROWED. Lowercased for whole-token comparison.
 *
 * The majority rule is deliberately conservative: a genuinely distinctive keyword
 * carried by only one of several same-family fast-path templates is also treated
 * as non-native (it cannot be told apart from a borrowed one from manifests
 * alone), so the guard demotes such a lone match to propose rather than risk an
 * out-of-family bind — safe (propose), never wrong.
 */
function familyNativeKeywords(
  family: string,
  manifests: Map<string, TemplateManifest>,
): Set<string> {
  const memberKeywordSets: Set<string>[] = [];
  for (const m of manifests.values()) {
    if (!m.fast_path_eligible || m.family !== family) continue;
    memberKeywordSets.push(new Set(m.intent_keywords.map((k) => k.toLowerCase())));
  }
  const counts = new Map<string, number>();
  for (const s of memberKeywordSets) for (const k of s) counts.set(k, (counts.get(k) ?? 0) + 1);
  const threshold = memberKeywordSets.length / 2;
  const native = new Set<string>();
  for (const [k, c] of counts) if (c > threshold) native.add(k);
  return native;
}

/**
 * FAMILY-LEVEL spatial intent guard vocabulary (W-23447710, Cluster A selection half).
 * The source of truth is the manifest set itself: any keyword carried by a
 * spatial-family manifest is spatial intent — INCLUDING non-eligible spatial supply,
 * so a lat/lon ask is protected even while spatial-symbol-map-latlon is unproven.
 * The alias set covers bare words users say that are not standalone manifest keywords.
 * Bare "map" stays OUT of CHART_NOUN_KEYWORDS (dual-carrier within spatial); this
 * guard operates only at family granularity, never picking a template.
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

function spatialIntentPhrases(manifests: Map<string, TemplateManifest>): Set<string> {
  const phrases = new Set<string>(SPATIAL_INTENT_ALIASES);
  for (const m of manifests.values()) {
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
  manifests: Map<string, TemplateManifest>,
): boolean {
  for (const phrase of spatialIntentPhrases(manifests)) {
    if (phraseIndexInAsk(maskedAsk, phrase) >= 0) return true;
  }
  return hasCoordinatePairIntent(rawAsk);
}

/**
 * Every field name / caption / bare column name in the schema, lowercased. Feeds
 * fieldNameMatchInAsk's EXACT-FIRST tie-break: a field's plural alias is suppressed
 * at any token another field claims by its exact name (so with both "Region" and
 * "Regions" present, ask "Regions" resolves to the exact "Regions" and "Region"'s
 * alias yields nothing there). Built from the SAME name-variant set that
 * matchFieldsInAsk / askNamesField test against, so suppression is exhaustive.
 */
function fieldExactNames(fields: SchemaField[]): Set<string> {
  const out = new Set<string>();
  for (const f of fields) {
    for (const n of [bareName(f.columnName), f.caption, f.name]) {
      if (n && n.length > 0) out.add(n.toLowerCase());
    }
  }
  return out;
}

/**
 * FIELD-NAME <-> ASK MATCH with a ONE-WAY, EXACT-FIRST trailing-`s` alias. Returns
 * the index of the first whole-token occurrence of field name `name` in `ask`, else
 * -1. This is the FIELD-ONLY matcher used by maskFieldNames / matchFieldsInAsk /
 * askNamesField; it is deliberately DISTINCT from phraseIndexInAsk (the keyword
 * matcher), which is UNCHANGED so keyword scoring is unaffected.
 *
 *   - EXACT FIRST: an exact whole-token occurrence always wins and is returned as-is.
 *   - ONE-WAY PLURAL ALIAS: if `name` does NOT already end in `s`, its naive plural
 *     `name + "s"` also matches — field "Region" matches ask token "Regions". A name
 *     that already ends in `s` gains NO singular alias, so "Sales" never matches
 *     "Sale", and "Species" / "Address" / "Tickets" / "Resolution Hours" stay
 *     exact-only.
 *   - NAIVE TRAILING-`s` ONLY: no ies / es / stemmer, so "Category" does NOT match
 *     "Categories" (deliberately out of scope for this MR).
 *   - EXACT-FIRST TIE-BREAK ACROSS FIELDS: the plural alias is suppressed whenever the
 *     pluralized token is another field's EXACT name (`exactNames`), so "Region"'s
 *     alias never claims a "Regions" span that a field literally named "Regions" owns
 *     by exact match.
 */
function fieldNameMatchInAsk(ask: string, name: string, exactNames: ReadonlySet<string>): number {
  const exact = phraseIndexInAsk(ask, name);
  if (exact >= 0) return exact;
  const n = name.toLowerCase().trim();
  if (!n || n.endsWith('s')) return -1; // one-way: an `s`-final name gains no alias
  const plural = `${n}s`;
  if (exactNames.has(plural)) return -1; // exact-first: another field owns this token
  return phraseIndexInAsk(ask, plural);
}

/**
 * Blank out whole-token occurrences of every field name/caption/bare column name
 * in the ask (replaced by spaces so token boundaries are preserved). Used for
 * TEMPLATE SELECTION and aggregation-word detection so a field NAME can never
 * drive chart-type choice or a spurious aggregation — e.g. a measure literally
 * named "O/U Line" must not score the trend-LINE template, and a field named
 * "Max Temp" must not read as a MAX aggregation. Field↔slot matching still runs
 * against the raw ask.
 */
function maskFieldNames(ask: string, s: SchemaSummary): string {
  let masked = ask;
  const exactNames = fieldExactNames(s.fields);
  // LONGEST FIELD NAME FIRST. Schema-order masking fragments a compound field:
  // masking "Region" before "Country/Region" turns it into "Country/      " so the
  // compound's own regex no longer matches, and the surviving "Country" token trips
  // spatial-choropleth-map's avoid_when → a spatial ask wrongly demotes to propose.
  // Masking the longest name first consumes the whole compound token before any of
  // its sub-names can fragment it.
  const fields = [...s.fields].sort((a, b) => b.name.length - a.name.length);
  for (const f of fields) {
    const names = [bareName(f.columnName), f.caption, f.name].filter(
      (n): n is string => !!n && n.length > 0,
    );
    for (const n of names) {
      const lower = n.toLowerCase();
      // ONE-WAY plural alias, in lockstep with fieldNameMatchInAsk: a name not already
      // ending in `s` also masks its naive plural token, so "Regions" is blanked WHOLE
      // for a field "Region" — no partial "region"+leftover-"s" residue that could then
      // keyword-match. Suppressed when the plural is another field's exact name (that
      // field masks the token itself), preserving exact-first tie-breaking.
      const pluralSuffix = !lower.endsWith('s') && !exactNames.has(`${lower}s`) ? 's?' : '';
      const re = new RegExp(`(^|[^a-z0-9])(${escapeRegex(lower)}${pluralSuffix})([^a-z0-9]|$)`, 'gi');
      masked = masked.replace(
        re,
        (_whole, pre: string, mid: string, post: string) => pre + ' '.repeat(mid.length) + post,
      );
    }
  }
  return masked;
}

/** Fields whose name/caption/bare column name appear in the ask, earliest-first. */
function matchFieldsInAsk(ask: string, s: SchemaSummary): SchemaField[] {
  const exactNames = fieldExactNames(s.fields);
  const hits: Array<{ field: SchemaField; index: number }> = [];
  for (const f of s.fields) {
    const names = [bareName(f.columnName), f.caption, f.name].filter(
      (n): n is string => !!n && n.length > 0,
    );
    let best = -1;
    for (const n of names) {
      const idx = fieldNameMatchInAsk(ask, n, exactNames);
      if (idx >= 0 && (best < 0 || idx < best)) best = idx;
    }
    if (best >= 0) hits.push({ field: f, index: best });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => h.field);
}

/** Whole-phrase test: does the ask NAME this field (by name, caption, or bare column)? */
function askNamesField(ask: string, f: SchemaField, exactNames: ReadonlySet<string>): boolean {
  const names = [bareName(f.columnName), f.caption, f.name].filter(
    (n): n is string => !!n && n.length > 0,
  );
  return names.some((n) => fieldNameMatchInAsk(ask, n, exactNames) >= 0);
}

/** Normalized content tokens of a field's name/caption/bare column name (for ask overlap). */
function fieldContentTokens(f: SchemaField): Set<string> {
  const out = new Set<string>();
  for (const n of [f.name, f.caption ?? '', bareName(f.columnName)]) {
    for (const t of contentTokens(n)) out.add(t);
  }
  return out;
}

/**
 * Bindable+required slot kinds across the shortlisted candidates (stage 2B
 * rank-2). A field is "kind-compatible" for narrowing if it fits ANY of these.
 */
function requiredSlotKinds(candidates: TemplateManifest[]): Set<SlotKind> {
  const kinds = new Set<SlotKind>();
  for (const m of candidates) {
    for (const slot of m.slots) {
      if (slot.bindable && slot.required) kinds.add(slot.kind);
    }
  }
  return kinds;
}

/**
 * Narrowing kind-fit (stage 2B): quantitative fields for quantitative slots,
 * date/datetime for temporal, dimensions for categorical/geo. Intentionally
 * broader than validate.ts's gate-3 `kindCompatible` (which the deterministic
 * gate still enforces later) — narrowing must not prematurely drop a field a
 * candidate could bind, only rank it.
 */
function fieldFitsSlotKind(kind: SlotKind, f: SchemaField): boolean {
  switch (kind) {
    case 'quantitative':
      return isMeasure(f);
    case 'temporal':
      return TEMPORAL_DATATYPES.has(f.datatype);
    case 'categorical':
    case 'geo':
      return f.role === 'dimension';
    default:
      return false; // calc/generated/pseudo/parameter are never user-bindable
  }
}

/**
 * Field-narrowing for the propose prompt (stage 2B, adjudicated attack 1). A wide
 * schema (300–1000 fields) would blow the prompt, so rank and cap:
 *   rank 1 — fields whose name/caption tokens overlap the ask (a field the ask
 *            NAMES is guaranteed rank-1, so it survives the cap);
 *   rank 2 — fields kind-compatible with any required slot of any candidate;
 *   rank 3 — everything else (fills headroom only).
 * Deterministic: stable sort keyed tier → named → overlap → name → original index.
 * A pass-through (≤ cap) returns the fields UNCHANGED with no withholding.
 */
function narrowFields(
  ask: string,
  fields: SchemaField[],
  kinds: Set<SlotKind>,
  maxFields: number,
): { fields: SchemaField[]; withheld: number } {
  if (fields.length <= maxFields) return { fields, withheld: 0 };

  const askTokens = contentTokens(ask);
  const exactNames = fieldExactNames(fields);
  const ranked = fields.map((f, index) => {
    const named = askNamesField(ask, f, exactNames);
    let overlap = 0;
    if (askTokens.size > 0) {
      for (const t of fieldContentTokens(f)) if (askTokens.has(t)) overlap++;
    }
    const relevant = named || overlap > 0;
    const compatible = !relevant && [...kinds].some((k) => fieldFitsSlotKind(k, f));
    const tier = relevant ? 2 : compatible ? 1 : 0;
    return { f, index, tier, named, overlap };
  });

  ranked.sort(
    (a, b) =>
      b.tier - a.tier ||
      Number(b.named) - Number(a.named) ||
      b.overlap - a.overlap ||
      a.f.name.localeCompare(b.f.name) ||
      a.index - b.index,
  );

  const kept = ranked.slice(0, maxFields).map((r) => r.f);
  return { fields: kept, withheld: fields.length - kept.length };
}

function isTemporal(f: SchemaField): boolean {
  return f.role === 'dimension' && TEMPORAL_DATATYPES.has(f.datatype);
}
function isMeasure(f: SchemaField): boolean {
  return f.role === 'measure' || f.isAggregated;
}
function isCategorical(f: SchemaField): boolean {
  return f.role === 'dimension' && !isTemporal(f) && (f.type === 'nominal' || f.type === 'ordinal');
}

/**
 * GEO SLOT ↔ FIELD NAME AFFINITY (fail-closed geo binding). A geo slot must not
 * take "the first unused dimension" (that silently SWAPS country↔state — worse than
 * proposing); it binds only a field whose name carries the slot's geographic concept.
 *
 * Each geo concept has a synonym set; a compound slot_id ("country_region",
 * "state_province") resolves to the concept of its FIRST recognized token (so
 * "country_region" → country, NOT the union country∪state which would over-match).
 */
const GEO_CONCEPT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  country: ['country', 'nation'],
  state: ['state', 'province', 'region', 'admin'],
};
/** Reverse index: a token → its geographic concept (drives slot_id → affinity). */
const GEO_TOKEN_CONCEPT: Readonly<Record<string, string>> = {
  country: 'country',
  nation: 'country',
  state: 'state',
  province: 'state',
  region: 'state',
  admin: 'state',
};

/** Split a name/slot_id into lowercased whole tokens (non-alphanumeric boundaries). */
function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Affinity token set for a geo slot: the synonym set of the concept named by the
 * slot_id's FIRST recognized geo token, else the slot_id's own literal tokens (an
 * exotic geo slot still matches fields sharing its name). "country_region" → the
 * country synonyms {country,nation}; "state_province" → {state,province,region,admin}.
 */
function geoAffinityTokens(slotId: string): Set<string> {
  for (const t of nameTokens(slotId)) {
    const concept = GEO_TOKEN_CONCEPT[t];
    if (concept) return new Set(GEO_CONCEPT_SYNONYMS[concept]);
  }
  return new Set(nameTokens(slotId));
}

/** Count of a geo slot's affinity tokens that appear as whole tokens in the field's names. */
function geoAffinityOverlap(f: SchemaField, aff: Set<string>): number {
  const ft = new Set<string>();
  for (const n of [f.name, f.caption ?? '', bareName(f.columnName)]) {
    for (const t of nameTokens(n)) ft.add(t);
  }
  let n = 0;
  for (const t of aff) if (ft.has(t)) n++;
  return n;
}

/**
 * The strictly-greatest, UNIQUE, > 0 geo-affinity field in `pool` for `aff`, as a
 * discriminated outcome so callers can tell the three cases apart: `ok` (a clean unique
 * winner), `none` (no field with any overlap), or `tie` (2+ fields tied at the max).
 * Computing over ONE fixed pool (never a shrinking one) is load-bearing — see
 * `resolveGeoSlots`.
 */
type GeoPick = { kind: 'ok'; field: SchemaField } | { kind: 'none' } | { kind: 'tie' };
function pickUniqueMaxAffinity(pool: SchemaField[], aff: Set<string>): GeoPick {
  let best: SchemaField | null = null;
  let bestOverlap = 0;
  let tie = false;
  for (const f of pool) {
    const ov = geoAffinityOverlap(f, aff);
    if (ov > bestOverlap) {
      best = f;
      bestOverlap = ov;
      tie = false;
    } else if (ov === bestOverlap && ov > 0) {
      tie = true;
    }
  }
  if (!best || bestOverlap === 0) return { kind: 'none' };
  if (tie) return { kind: 'tie' };
  return { kind: 'ok', field: best };
}

/**
 * Resolve every required geo slot to a distinct field by NAME AFFINITY. Fail-closed
 * (returns null → the caller proposes) when a geo slot is not UNAMBIGUOUS: each binds
 * the field with the strictly-greatest, unique, > 0 affinity overlap. A final
 * distinctness check rejects two geo slots resolving to the SAME field. Computing every
 * slot's overlap over the SAME pool (not a shrinking one) is load-bearing: it lets a
 * coarse phantom like "Region" (a sub-token of "Country/Region") tie the state slot
 * against "Country/Region" and fail closed, rather than being silently mis-bound.
 *
 * W60 GEO-SLOT COMPLETION: a REQUIRED geo slot with ZERO ask-named candidates widens
 * THAT slot's pool to the full schema's dimensions (`schemaDims`) and binds the unique
 * name-affine field there — BUT only when at least one OTHER geo slot was satisfied from
 * the ask-named pool (the ask demonstrated geographic intent by naming ≥1 geo field).
 * The unique-max + distinctness rules still hold over the widened pool, so a schema with
 * two country-affine fields (a tie) or none still fails closed; an ask that names NO geo
 * field at all keeps the pre-W60 fail-closed behavior. A `tie` in the ASK-NAMED pool
 * always fails closed (the ask named ambiguous candidates) and never widens. Slots
 * auto-completed from the widened pool are returned so the caller can surface which
 * field it chose for a slot the ask did not name.
 */
function resolveGeoSlots(
  geoSlots: TemplateManifest['slots'],
  pool: SchemaField[],
  schemaDims: SchemaField[],
): { picks: Map<string, SchemaField>; autoCompleted: Map<string, SchemaField> } | null {
  const picks = new Map<string, SchemaField>();
  const zeroSlots: TemplateManifest['slots'] = [];
  let anyAskNamed = false;

  // Phase 1 — resolve from the ASK-NAMED pool. A tie fails closed immediately.
  for (const slot of geoSlots) {
    const pick = pickUniqueMaxAffinity(pool, geoAffinityTokens(slot.slot_id));
    if (pick.kind === 'tie') return null; // ask named 2+ tied candidates → fail closed
    if (pick.kind === 'ok') {
      picks.set(slot.slot_id, pick.field);
      anyAskNamed = true;
    } else {
      zeroSlots.push(slot);
    }
  }

  // Phase 2 — widen each zero-candidate slot to the full schema, but ONLY when the ask
  // named ≥1 geo field. No ask-named geo slot ⇒ no geographic intent ⇒ fail closed.
  const autoCompleted = new Map<string, SchemaField>();
  if (zeroSlots.length > 0) {
    if (!anyAskNamed) return null;
    for (const slot of zeroSlots) {
      const widened = pickUniqueMaxAffinity(schemaDims, geoAffinityTokens(slot.slot_id));
      if (widened.kind !== 'ok') return null; // still zero, or now ambiguous → fail closed
      picks.set(slot.slot_id, widened.field);
      autoCompleted.set(slot.slot_id, widened.field);
    }
  }

  const chosen = [...picks.values()];
  if (new Set(chosen).size !== chosen.length) return null; // two slots, one field
  return { picks, autoCompleted };
}

/**
 * EXPLICIT TIME-AXIS INTENT (unique-date temporal completion). Conservative
 * allowlist of phrases that UNAMBIGUOUSLY ask for a time axis, so a required
 * temporal slot the ask did not name may be auto-completed with the schema's lone
 * date field. Matched as WHOLE tokens against the MASKED ask (field names blanked),
 * so a field literally named "Trend"/"Calendar"/"Period" can never arm completion.
 * Hyphenated cues also match their natural spaced form via phraseIndexInAsk's
 * `-`→[\s-]+ transform ("over-time" hits "over time"; "by-month" hits "by month").
 * DELIBERATELY excludes bare 'line' (a mark type, not a time axis) and vague filter
 * phrases like "right now" — they do not name a time axis, so must not trigger a
 * date auto-completion. Mirrors FACET_CUES: a tight, explicit-cue-only allowlist.
 */
const TIME_INTENT_CUES: readonly string[] = [
  'trend',
  'timeline',
  'time-series',
  'over-time',
  'by-month',
  'by-week',
  'by-quarter',
  'by-year',
  'calendar',
  'period',
  'change-over-time',
  'month-over-month',
  'year-over-year',
  'yoy',
];

/** True when the (masked) ask carries an explicit time-axis cue from the allowlist. */
function askHasExplicitTimeIntent(maskedAsk: string): boolean {
  return TIME_INTENT_CUES.some((cue) => phraseIndexInAsk(maskedAsk, cue) >= 0);
}

/**
 * UNIQUE-DATE TEMPORAL COMPLETION (mirrors the W60 geo-slot completion). When a
 * chosen template's lone required temporal slot was NOT filled by an ask-named
 * field, complete it with the schema's SINGLE date/datetime field — but only under
 * strict, fail-closed preconditions so it can never introduce ambiguity:
 *   - the masked ask carries EXPLICIT time-axis intent (`TIME_INTENT_CUES`) — a bare
 *     mark word like 'line' is not enough;
 *   - the ask names EXACTLY ONE compatible measure (0 ⇒ nothing to plot; 2+ ⇒ not a
 *     plain single-measure trend, e.g. a dual-axis combo, so fail closed);
 *   - the schema has EXACTLY ONE temporal field total passing `isTemporal` (0 ⇒
 *     nothing to complete; 2+ ⇒ ambiguous which date, so fail closed — the strict
 *     one-candidate floor, exactly like geo's unique-max rule).
 * Any miss ⇒ null. The caller runs this ONLY in the FINAL bind pass (never in
 * selectWithinFamily's slot-fit probes), so completion can never make an extra
 * candidate look bindable during tie-breaking.
 */
function completeTemporalSlot(
  maskedAsk: string,
  matched: SchemaField[],
  schemaFields: SchemaField[],
): SchemaField | null {
  if (!askHasExplicitTimeIntent(maskedAsk)) return null;
  if (matched.filter(isMeasure).length !== 1) return null;
  const temporals = schemaFields.filter(isTemporal);
  if (temporals.length !== 1) return null;
  return temporals[0];
}

/**
 * Role-greedy field assignment (design §3.5 step 2): fill each required, bindable
 * slot with the first still-unused matched field of the compatible role/kind —
 * measures → quantitative, dimensions → categorical/temporal. GEO slots are the
 * exception: they do NOT take "the first unused dimension" (that silently swaps
 * country↔state); they resolve as a group by slot↔field NAME AFFINITY
 * (`resolveGeoSlots`), fail-closed on any ambiguity. Returns the bindings, or null
 * if any required slot is left unfilled (fail-closed). An explicit aggregation
 * override applies only to quantitative slots.
 *
 * Shared machinery: classifyNoLlm emits with it, and the intra-family tiebreak's
 * slot-fit test calls it to answer "do the ask's fields satisfy this candidate?"
 * with the exact assignment that would be emitted — no separate approximation.
 *
 * `temporalCompletion` is supplied ONLY by classifyNoLlm's FINAL bind pass (the
 * masked ask + full schema fields for unique-date completion). selectWithinFamily's
 * slot-fit probes omit it, so a required temporal slot the ask did not name can be
 * auto-completed from the schema's lone date field ONLY in the final bind — never
 * during tie-breaking, where it could make an extra candidate look bindable.
 */
function roleGreedyBind(
  m: TemplateManifest,
  matched: SchemaField[],
  aggOverride: Derivation | null,
  schemaDims: SchemaField[],
  temporalCompletion?: { maskedAsk: string; schemaFields: SchemaField[] } | null,
): {
  bindings: Array<{ slot_id: string; field: string; derivation?: Derivation }>;
  provenance: string[];
} | null {
  const used = new Set<SchemaField>();
  const bindings: Array<{ slot_id: string; field: string; derivation?: Derivation }> = [];
  // A REQUIRED calc forces its bindable input slots to bind even when the slot is
  // authored optional (H3) — otherwise the calc's formula ref would dangle and the
  // no-LLM path would needlessly escalate.
  const forced = calcForcedSlotIds(m);

  const take = (pred: (f: SchemaField) => boolean): SchemaField | null => {
    for (const f of matched) {
      if (!used.has(f) && pred(f)) {
        used.add(f);
        return f;
      }
    }
    return null;
  };

  const isActive = (slot: TemplateManifest['slots'][number]): boolean =>
    slot.bindable && (slot.required || forced.has(slot.slot_id));
  const geoSlots = m.slots.filter((s) => isActive(s) && s.kind === 'geo');
  let geoPicks: Map<string, SchemaField> | null = null;
  let geoAutoCompleted = new Map<string, SchemaField>();
  let geoResolved = false;
  // Active required temporal slots. Unique-date completion arms ONLY when there is
  // exactly ONE (a multi-temporal template never auto-fills a date, fail closed).
  const temporalSlots = m.slots.filter((s) => isActive(s) && s.kind === 'temporal');
  const temporalAutoCompleted = new Map<string, SchemaField>();

  for (const slot of m.slots) {
    if (!isActive(slot)) continue;
    let chosen: SchemaField | null = null;
    switch (slot.kind) {
      case 'quantitative':
        chosen = take(isMeasure);
        break;
      case 'categorical':
        chosen = take(isCategorical);
        break;
      case 'temporal':
        chosen = take(isTemporal);
        // UNIQUE-DATE TEMPORAL COMPLETION (final bind pass only; mirrors W60 geo): a
        // lone required temporal slot the ask did not name is completed with the
        // schema's single date field, under the strict preconditions in
        // completeTemporalSlot. `temporalCompletion` is passed ONLY by classifyNoLlm's
        // final bind — selectWithinFamily's slot-fit probes omit it, so completion can
        // never make an extra candidate look bindable during tie-breaking.
        if (!chosen && temporalCompletion && temporalSlots.length === 1) {
          const completed = completeTemporalSlot(
            temporalCompletion.maskedAsk,
            matched,
            temporalCompletion.schemaFields,
          );
          if (completed) {
            used.add(completed);
            temporalAutoCompleted.set(slot.slot_id, completed);
            chosen = completed;
          }
        }
        break;
      case 'geo': {
        // Resolve ALL geo slots together on first encounter, over the dimensions not
        // already consumed by the non-geo slots (which precede geo in every eligible
        // template). Name affinity replaces "first unused dimension", so a geo slot
        // binds only a name-matching field or fails closed — never a silent swap. A
        // required geo slot the ask does not name widens to the full schema's
        // dimensions (`schemaDims`) when another geo slot IS named (W60).
        if (!geoResolved) {
          const pool = matched.filter((f) => !used.has(f) && f.role === 'dimension');
          const resolved = resolveGeoSlots(geoSlots, pool, schemaDims);
          if (resolved) {
            geoPicks = resolved.picks;
            geoAutoCompleted = resolved.autoCompleted;
            for (const f of geoPicks.values()) used.add(f);
          }
          geoResolved = true;
        }
        chosen = geoPicks ? (geoPicks.get(slot.slot_id) ?? null) : null;
        break;
      }
      default:
        chosen = null;
    }
    if (!chosen) return null; // required slot unfilled / geo affinity ambiguous → fail closed
    const binding: { slot_id: string; field: string; derivation?: Derivation } = {
      slot_id: slot.slot_id,
      field: chosen.name,
    };
    if (slot.kind === 'quantitative' && aggOverride) binding.derivation = aggOverride;
    bindings.push(binding);
  }

  // Surface any geo slot AUTO-COMPLETED from the full schema (W60) as provenance, so the
  // caller can tell the agent which field it chose for a slot the ask did not name.
  const provenance: string[] = [];
  for (const [slotId, f] of geoAutoCompleted) {
    provenance.push(
      `Using '${f.name}' for the required geo slot '${slotId}' — auto-completed from the ` +
        'datasource because the ask named no matching field.',
    );
  }
  // Surface a temporal slot AUTO-COMPLETED from the schema's lone date field (unique-
  // date completion, W60 geo sibling) so the caller can tell the agent which field it
  // chose for a required time axis the ask did not name.
  for (const [slotId, f] of temporalAutoCompleted) {
    provenance.push(
      `Using '${f.name}' for required temporal slot '${slotId}' because it is the only date field in the datasource.`,
    );
  }

  return { bindings, provenance };
}

/**
 * WITHIN-FAMILY template selection (stage 2b). Given the keyword-argmax `top`
 * (all sharing the max keyword score) plus the ask's recognizable fields, pick a
 * single template to auto-bind or return null to fall through to the propose leg.
 * Two regimes, driven by the measured scale breakpoints:
 *
 *  • SINGLE keyword winner (top.length === 1) — SOLE-WRONG-MATCHER GUARD. A lone
 *    matcher may auto-bind only if at least one keyword it matched is FAMILY-NATIVE
 *    (`familyNativeKeywords`) OR is a distinctive CHART NOUN (`CHART_NOUN_KEYWORDS`).
 *    The family-native rule kills the ramp-up wrong-family bind where a template is
 *    the SOLE matcher of another family's keyword it merely borrowed (that borrowed
 *    keyword is not native → demote). The chart-noun exemption is the sibling-scaling
 *    fix: adding an eligible sibling drops a distinctive noun like "bar"/"column"/
 *    "pie" below the majority threshold, but a chart noun deterministically names a
 *    type, so a lone chart-noun winner must still one-shot rather than escalate.
 *
 *  • TIE (top.length > 1) — INTRA- or CROSS-FAMILY TIEBREAK.
 *    A tie WITHIN one family has an unambiguous family, so rather than fail closed
 *    we bind: among the candidates whose required slots the ask's fields satisfy,
 *    rank by keyword specificity (longer/multi-token first), break remaining ties by
 *    template name, take the top. If NO tied candidate is slot-satisfiable, propose.
 *    A tie SPANNING families is genuinely ambiguous EXCEPT when a single candidate's
 *    most-specific matched CHART NOUN strictly outranks every other's ("stacked bar"
 *    → part-to-whole beats a generic ranking "bar"): that deterministic chart-type
 *    winner binds if slot-satisfiable. No unique chart-noun winner → fail closed
 *    (propose), preserving the ambiguous-ask contract. Whatever is picked is a chart
 *    the ask explicitly named, so this never introduces a wrong bind.
 */
function selectWithinFamily(
  top: Array<{ m: TemplateManifest }>,
  maskedAsk: string,
  matched: SchemaField[],
  aggOverride: Derivation | null,
  manifests: Map<string, TemplateManifest>,
  schemaDims: SchemaField[],
): TemplateManifest | null {
  if (top.length === 1) {
    const m = top[0].m;
    const native = familyNativeKeywords(m.family, manifests);
    const won = matchedKeywords(maskedAsk, m.intent_keywords);
    const decisive =
      won.some((kw) => native.has(kw.toLowerCase())) || wonChartNoun(maskedAsk, m.intent_keywords);
    return decisive ? m : null;
  }

  const families = new Set(top.map((t) => t.m.family));
  if (families.size > 1) {
    // CROSS-family tie: fail closed UNLESS one candidate's most-specific matched
    // chart noun strictly outranks the rest. Rank slot-satisfiable chart-noun
    // matchers by chart-noun specificity, break ties by template name; a strict
    // #1 binds, a #1/#2 specificity tie (or no chart-noun matcher) stays null.
    const byNoun = top
      .map((t) => ({ m: t.m, spec: chartNounSpecificity(maskedAsk, t.m.intent_keywords) }))
      .filter((c) => c.spec > 0 && roleGreedyBind(c.m, matched, aggOverride, schemaDims) !== null)
      .sort((a, b) => b.spec - a.spec || a.m.template.localeCompare(b.m.template));
    if (byNoun.length === 0) return null;
    if (byNoun.length > 1 && byNoun[0].spec === byNoun[1].spec) return null;
    return byNoun[0].m;
  }

  const bindable = top
    .map((t) => ({ m: t.m, spec: keywordSpecificity(maskedAsk, t.m.intent_keywords) }))
    .filter((c) => roleGreedyBind(c.m, matched, aggOverride, schemaDims) !== null);
  if (bindable.length === 0) return null; // none bindable → propose
  bindable.sort((a, b) => b.spec - a.spec || a.m.template.localeCompare(b.m.template));
  return bindable[0].m;
}

/**
 * SMALL-MULTIPLES FACET CUES (W23-SM1). Explicit facet/trellis vocabulary a user
 * types when they want one chart PER member (side-by-side panes), NOT a color/detail
 * grouping. Deliberately tight: a bare "by <dim>" is ambiguous (could be a color
 * encoding) and is EXCLUDED — only these unambiguous cues (plus "per", which the spec
 * names for per-category facets) arm a facet bind. Matched as WHOLE tokens against the
 * MASKED ask (field names blanked) so a field literally named "per…"/"facet…" can't
 * arm it, and so faceting is a phrasing decision, never a field-name accident.
 */
const FACET_CUES: readonly string[] = [
  'small multiple',
  'small multiples',
  'trellis',
  'facet',
  'faceted',
  'facets',
  'faceting',
  'for each',
  'one per',
  'per',
];

/** True when the (masked) ask carries explicit small-multiples / facet intent. */
function askImpliesFacet(maskedAsk: string): boolean {
  return FACET_CUES.some((cue) => phraseIndexInAsk(maskedAsk, cue) >= 0);
}

/**
 * A manifest's OPTIONAL trellis facet slot: bindable + optional + categorical, on
 * rows or cols, with a `facet*` slot_id (facet / facet_row / facet_col). This is the
 * single dimension placed AHEAD of the existing pill for a simple one-dim trellis.
 */
function isFacetSlot(s: TemplateManifest['slots'][number]): boolean {
  return (
    s.bindable &&
    !s.required &&
    s.kind === 'categorical' &&
    s.slot_id.startsWith('facet') &&
    (s.role.includes('rows') || s.role.includes('cols'))
  );
}

/**
 * FAIL-CLOSED optional-facet augmentation (W23-SM1). Purely ADDITIVE: called only
 * AFTER the required slots have bound, it appends ONE categorical facet binding when
 * (a) the ask names/implies a facet, (b) the template declares an optional facet slot
 * not already bound, and (c) a spare categorical the ask NAMED remains after the
 * required slots. Any miss ⇒ null (no facet). It never changes template selection, the
 * required-slot bindings, or the bound/unbound decision, and never steals a slot-bound
 * dim (excluded via `boundFields`) — so a no-cue / no-spare ask is byte-unchanged.
 */
function facetBinding(
  m: TemplateManifest,
  bound: Array<{ slot_id: string; field: string; derivation?: Derivation }>,
  matched: SchemaField[],
  maskedAsk: string,
): { slot_id: string; field: string } | null {
  if (!askImpliesFacet(maskedAsk)) return null;
  const boundIds = new Set(bound.map((b) => b.slot_id));
  const facetSlot = m.slots.find((s) => isFacetSlot(s) && !boundIds.has(s.slot_id));
  if (!facetSlot) return null;
  const boundFields = new Set(bound.map((b) => b.field));
  const spare = matched.find((f) => isCategorical(f) && !boundFields.has(f.name));
  if (!spare) return null;
  return { slot_id: facetSlot.slot_id, field: spare.name };
}

/**
 * No-LLM classification (design §3.5 + stage 2b within-family disambiguation).
 * Keyword-scores the eligible fast-path templates, selects a single template via
 * `selectWithinFamily` (sole-wrong-matcher guard for a lone winner; intra-family
 * tiebreak for a same-family tie; fail-closed for a cross-family tie), then
 * role-greedily assigns matched fields to its required bindable slots by kind.
 * Returns null (fall through to the LLM propose path) whenever no template is
 * selected, avoid_when demotes, or a required slot is left unfilled.
 *
 * `summary` is required to assign by kind (the design's §3.2 signature omitted it,
 * but §3.5 step 2 needs the field roles to map measures→quantitative etc.).
 */
export function classifyNoLlm(
  ask: string,
  manifests: Map<string, TemplateManifest>,
  summary: SchemaSummary,
): {
  template: string;
  bindings: Array<{ slot_id: string; field: string; derivation?: Derivation }>;
  /** Advisory provenance (e.g. a required geo slot auto-completed from the schema, W60). Present only when non-empty. */
  notes?: string[];
} | null {
  // FAIL-CLOSED cost guard (M10 Finding 3): over the field cap, do NOT run the per-field
  // hot loop (maskFieldNames / matchFieldsInAsk) and do NOT classify a truncated subset —
  // return null so the orchestrator escalates rather than risk a silent wrong bind on a
  // partial view. Checked at the TOP, before any field is touched, so cost stays bounded.
  if (summary.fields.length > MAX_CLASSIFIABLE_FIELDS) return null;

  // Mask field names before scoring so a field NAME can't select a template or
  // read as an aggregation word; field↔slot matching still uses the raw ask.
  const maskedAsk = maskFieldNames(ask, summary);
  const aggOverride = detectAggregationOverride(maskedAsk);
  const matched = matchFieldsInAsk(ask, summary);
  // The full dimension pool a required geo slot widens into when the ask names no
  // affine candidate for it (W60 geo-slot completion).
  const schemaDims = summary.fields.filter((f) => f.role === 'dimension');

  // Keyword-score the eligible fast-path templates against the masked ask.
  const scored: Array<{ m: TemplateManifest; score: number }> = [];
  for (const m of manifests.values()) {
    if (!m.fast_path_eligible) continue;
    const score = keywordScore(maskedAsk, m.intent_keywords);
    if (score > 0) scored.push({ m, score });
  }
  if (scored.length === 0) return null;

  const maxScore = scored.reduce((mx, s) => Math.max(mx, s.score), 0);
  const top = scored.filter((s) => s.score === maxScore);

  const chosen = selectWithinFamily(top, maskedAsk, matched, aggOverride, manifests, schemaDims);
  if (!chosen) return null;

  // DEMOTE (family guard, W-23447710): a spatial-intent ask must never bind a
  // non-spatial keyword-count winner. Bare "map" stays out of CHART_NOUN_KEYWORDS
  // because it is dual-carrier within spatial; this guard is family-granular only.
  if (askCarriesSpatialIntent(ask, maskedAsk, manifests) && chosen.family !== 'spatial') {
    return null;
  }

  // DEMOTE (never hard-block): when the selected winner carries avoid_when
  // guidance whose terms appear in the ask, fall through to the propose leg so
  // the model can WEIGH the caution rather than the zero-latency path committing
  // silently (the retrieval-without-adherence failure). Field names are masked
  // so a field literally named after a caution term can't force the demotion.
  if (matchAvoidWhen(maskedAsk, chosen.avoid_when, chosen.intent_keywords).length > 0) return null;

  // DEMOTE on data-shape-parse hazards (W59): avoid_when only fires when the ASK
  // reveals the risk, but a data-shape hazard lives in the DATA, which no natural
  // ask mentions — "over-under arrow chart of Sales by Sub-Category" happily bound
  // ww-ou-arrow and fed [Category] into sports-score SPLIT parsing (live-caught by
  // the W59 proof-value spike + dual review). A template whose calcs parse a
  // specific string shape out of a bound field can never prove data fit on the
  // zero-model path, so it always falls through to propose, where the model sees
  // the hazard notes + avoid_when and judges the actual schema.
  if (hasDeterministicPathBlockingHazard(chosen)) return null;

  // FINAL bind pass — the ONLY place unique-date temporal completion is armed (pass
  // the masked ask + full schema so a lone required date slot the ask did not name
  // can complete with the schema's single date field). selectWithinFamily's earlier
  // slot-fit probes deliberately omit this context (no completion during tie-break).
  const rgb = roleGreedyBind(chosen, matched, aggOverride, schemaDims, {
    maskedAsk,
    schemaFields: summary.fields,
  });
  if (!rgb) return null; // required slot unfilled → fail closed
  const bindings = rgb.bindings;
  // OPTIONAL small-multiples facet (W23-SM1): additively bind a simple-trellis facet
  // dim (a spare categorical placed AHEAD of the existing pill) ONLY when the ask
  // names/implies a by-<dim> facet AND a spare categorical remains. This never flips
  // the bound decision, the chosen template, or the required bindings — a no-cue /
  // no-spare ask returns the exact same {template, bindings} as before.
  const facet = facetBinding(chosen, bindings, matched, maskedAsk);
  if (facet) bindings.push(facet);
  // Attach provenance (e.g. W60 geo auto-completion) only when non-empty, so a
  // non-geo / no-auto-complete ask returns the exact same {template, bindings} shape.
  return rgb.provenance.length > 0
    ? { template: chosen.template, bindings, notes: rgb.provenance }
    : { template: chosen.template, bindings };
}

/**
 * Build the compact LLM input (design §3.3): keyword-ranked fast-path candidates
 * (Fuse fallback when no exact hit), each with its BINDABLE slots only, plus the
 * field schema. The model only picks a template + maps slot_id→field name.
 */
export function buildLlmInput(
  ask: string,
  manifests: Map<string, TemplateManifest>,
  summary: SchemaSummary,
  opts?: { maxFields?: number },
): LlmProposeInput {
  const maxFields = opts?.maxFields ?? DEFAULT_MAX_FIELDS;
  // ROUTABLE pool = fast-path-eligible templates PLUS side-loaded LOCAL templates
  // (W2-C1). Local templates arrive UNSTAMPED (fast_path_eligible false), so they
  // never enter classifyNoLlm's auto-bind, but they MUST be visible to the propose
  // shortlist by family/keyword so the model can route to them. When no local set
  // is side-loaded this is byte-identical to the eligible-only pool.
  const routable = [...manifests.values()].filter(
    (m) => m.fast_path_eligible || m.source === 'local',
  );

  let candidates = routable
    .map((m) => ({ m, score: keywordScore(ask, m.intent_keywords) }))
    .filter((x) => x.score > 0);

  if (candidates.length === 0) {
    // No exact keyword hit: use Fuse over keywords/description to surface the
    // nearest templates; if even that is empty, offer all routable templates.
    const fuse = new Fuse(routable, {
      keys: ['intent_keywords', 'description'],
      threshold: 0.5,
    });
    const hits = fuse.search(ask).map((r) => r.item);
    const chosen = hits.length > 0 ? hits : routable;
    candidates = chosen.map((m) => ({ m, score: 0 }));
  }

  candidates.sort((a, b) => b.score - a.score || a.m.template.localeCompare(b.m.template));

  // Family-aware truncation (attack 2): cap at K total, but NEVER silently drop a
  // whole matching family. Seed the best candidate of each matching family first
  // (so if >K families match, the shortlist over-caps to one-per-family — that IS
  // the propose leg), then fill any remaining headroom up to K with the next-best
  // candidates. A naive slice(0,K) could truncate an entire family below K.
  const K = 5;
  const pickedTemplates = new Set<string>();
  const seededFamilies = new Set<string>();
  const top: typeof candidates = [];
  for (const c of candidates) {
    if (seededFamilies.has(c.m.family)) continue;
    seededFamilies.add(c.m.family);
    top.push(c);
    pickedTemplates.add(c.m.template);
  }
  for (const c of candidates) {
    if (top.length >= K) break;
    if (pickedTemplates.has(c.m.template)) continue;
    top.push(c);
    pickedTemplates.add(c.m.template);
  }
  top.sort((a, b) => b.score - a.score || a.m.template.localeCompare(b.m.template));

  // FIELD-NARROWING (stage 2B): rank the schema against the shortlisted
  // candidates' required slot kinds + the ask, and cap at maxFields so a wide
  // schema can't blow the propose prompt. classifyNoLlm is untouched — it still
  // resolves against the full schema.
  const kinds = requiredSlotKinds(top.map((c) => c.m));
  // FAIL-CLOSED cost guard (M10 Finding 3): narrowFields runs one regex per field
  // (askNamesField) — the same unbounded hot loop classifyNoLlm caps. Over the cap, rank
  // only a bounded prefix so a pathological wide schema can't block the event loop for
  // seconds; `withheld` below is computed against the TRUE total so more_available stays
  // honest and the caller is told to re-query with a field-name hint.
  const rankPool =
    summary.fields.length > MAX_CLASSIFIABLE_FIELDS
      ? summary.fields.slice(0, MAX_CLASSIFIABLE_FIELDS)
      : summary.fields;
  const { fields: narrowed } = narrowFields(ask, rankPool, kinds, maxFields);
  const withheld = summary.fields.length - narrowed.length;

  const result: LlmProposeInput = {
    ask,
    candidate_templates: top.map(({ m }) => ({
      template: m.template,
      description: m.description,
      intent_keywords: m.intent_keywords,
      // Surface the negative guidance so the proposing model sees the cautions.
      ...(m.avoid_when && m.avoid_when.length > 0 ? { avoid_when: m.avoid_when } : {}),
      slots: m.slots
        .filter((slot) => slot.bindable)
        .map((slot) => ({
          slot_id: slot.slot_id,
          role: slot.role,
          kind: slot.kind,
          required: slot.required,
          derivation: slot.derivation, // template default; override only if the ask differs
        })),
    })),
    fields: narrowed.map((f) => ({
      name: f.name,
      role: f.role,
      type: f.type,
      datatype: f.datatype,
    })),
  };

  if (withheld > 0) {
    result.more_available = {
      count: withheld,
      note:
        `Narrowed to the top ${narrowed.length} of ${summary.fields.length} fields most ` +
        `relevant to the ask; ${withheld} withheld. Re-query with a field-name hint ` +
        '(name the field you need) to surface others.',
    };
  }

  return result;
}
