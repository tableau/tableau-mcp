// src/desktop/binder/route-spec.ts
//
// The route layer's typed REGISTRY (Slice B, ported from a2td src/binder/route-spec.ts). A
// typed table mapping an ask-SHAPE to a route class, plus a schema-free shape classifier that
// REUSES the binder's own model-free matcher (`selectEligible` in ask-router.ts) for
// bind-first detection — it NEVER re-derives classification.
//
// The classifier is deterministic + model-free: the route is computed once from the ask/task
// text, before any live workbook schema is known. It reuses `selectEligible` (keyword /
// family-native / chart-noun selection over the masked ask), the same selection rules the
// binder runs; the full field-binding classifier additionally needs a live schema and so
// cannot run here.
//
//   bind-first       — a plain chart shape whose template supply is STAMPED/eligible. Gated on
//                      `selectEligible`, which filters `fast_path_eligible`, so a route can
//                      never point at unproven supply.
//   scratch-pipeline — a hazard shape the binder has no fast-path supply for (sets,
//                      drilldown): the general from-scratch authoring path owns it.
//   refine-op        — supported refine-asks (top-N / sort). Unsupported/deferred refine asks
//                      remain `free` until their typed worksheet adapters exist.
//   free             — the fail-open default (organic asks, no matched eligible supply).

import { selectEligible } from './ask-router.js';
import type { TemplateManifest } from './manifest-types.js';

/** The four route classes an ask-shape maps to. */
export type RouteClass = 'bind-first' | 'scratch-pipeline' | 'refine-op' | 'free';

/**
 * The recognized ask shapes. `refine-*` shapes are the refine taxonomy; only the worksheet
 * adapters that exist route to `refine-op` (the tmcp refine-worksheet fast lane covers
 * refine-top-n / refine-sort — Slice A).
 */
export type AskShape =
  | 'empty'
  | 'hazard-set'
  | 'hazard-drilldown'
  | 'refine-top-n'
  | 'refine-filter'
  | 'refine-sort'
  | 'refine-period'
  | 'refine-encoding'
  | 'bind-first-template'
  | 'unmatched';

/**
 * THE TYPED TABLE. ask-shape → route class. Only supported refine shapes map to `refine-op`;
 * the rest stay `free`, which is exactly why the taxonomy is separated from the route.
 */
export const SHAPE_ROUTE: Record<AskShape, RouteClass> = {
  empty: 'free',
  'hazard-set': 'scratch-pipeline',
  'hazard-drilldown': 'scratch-pipeline',
  'refine-top-n': 'refine-op',
  'refine-filter': 'free',
  'refine-sort': 'refine-op',
  'refine-period': 'free',
  'refine-encoding': 'free',
  'bind-first-template': 'bind-first',
  unmatched: 'free',
};

/** The refine-taxonomy shapes; only a subset currently routes to `refine-op`. */
export const REFINE_SHAPES: ReadonlySet<AskShape> = new Set<AskShape>([
  'refine-top-n',
  'refine-filter',
  'refine-sort',
  'refine-period',
  'refine-encoding',
]);

export interface RouteDecision {
  /** The route class the ask-shape maps to (via SHAPE_ROUTE). */
  route: RouteClass;
  /** The classified ask shape. */
  shape: AskShape;
  /** The eligible template the matcher selected, when the shape is bind-first-template. */
  template: string | null;
  /** One-line, deterministic rationale (for audit). */
  reason: string;
}

// ───────────────────────── shape detectors (deterministic, no model) ─────────────────────────

/**
 * HAZARD shapes the binder has no fast-path supply for: Tableau SETS and DRILLDOWN
 * (hierarchy navigation). These never bind a stamped template; routing them `free` lets an
 * agent fall to whole-workbook XML surgery, so the registry routes them to the general
 * scratch pipeline explicitly.
 */
function detectHazard(text: string): AskShape | null {
  // Any drill* form: "drill down", "drilldown", "drill-down", "drill into", "drilling".
  if (/\bdrill/i.test(text)) return 'hazard-drilldown';
  // A Tableau "set" — require a construction/containment cue so "dataset"/"subset"/
  // "settings" can't false-fire.
  if (
    /\b(?:create|make|define|build|combine|combined|new|add|group)\s+(?:an?\s+)?sets?\b/i.test(
      text,
    ) ||
    /\bsets?\s+of\b/i.test(text) ||
    /\b(?:into|as)\s+(?:an?\s+)?sets?\b/i.test(text)
  ) {
    return 'hazard-set';
  }
  return null;
}

const NUMBER_WORD =
  '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|fifty|hundred)';
const TOP_N_RE = new RegExp(
  `\\b(?:top|bottom|highest|lowest|first|last)\\s+${NUMBER_WORD}\\b`,
  'i',
);

/**
 * NEW-VIZ signal: a chart-type noun or a generic viz word. Its presence marks the ask as a
 * request to BUILD a chart, so bare top-N / period / sort VOCABULARY in it is new-viz wording,
 * not a refinement of an on-screen viz.
 */
const NEW_VIZ_RE =
  /\b(?:bars?|columns?|line|lines|pie|donut|treemap|maps?|scatter|histogram|bullet|gantt|funnel|waterfall|heat-?map|box-?plot|area|bubble|slope|charts?|graphs?|plots?|viz|visuali[sz]ations?|dashboards?)\b/i;

/**
 * EDIT signals — the evidence that an ask REFINES an already-built viz. Either an anaphora
 * referring to an existing viz, or an explicit instruction to modify one. The anaphora form is
 * scoped to VIZ nouns so a NEW-viz constraint (e.g. "using its existing datasource … do not
 * delete existing worksheets") is not misread as a refinement.
 */
const EDIT_ANAPHORA_RE =
  /\b(?:this|that|the|current|existing)\s+(?:(?:bar|line|column|pie|scatter|area|stacked)\s+)?(?:chart|graph|plot|viz|visuali[sz]ation|view|dashboard)\b/i;
// "current/this/that sheet" is an edit signal too. Deliberately not bare
// "existing worksheets", which appears in do-not-replace-new-viz wording.
const CURRENT_SHEET_RE = /\b(?:current|this|that)\s+(?:work)?sheet\b/i;
const EDIT_INSTRUCTION_RE =
  /\b(?:fix|repair|change|modify|update|convert|swap|re-?colou?r|re-?sort|adjust|tweak|instead)\b|\b(?:make|show|render|turn|set)\s+(?:it|that|this|them|these|those)\b/i;
const NON_SHEET_FIX_RE = /\b(?:fix|repair)\s+(?:the\s+)?(?:data\s+source|datasource|connection)\b/i;

/** True when the ask carries an EDIT signal (anaphora to an existing viz OR a modify instruction). */
function hasEditContext(text: string): boolean {
  if (NON_SHEET_FIX_RE.test(text) && !EDIT_ANAPHORA_RE.test(text) && !CURRENT_SHEET_RE.test(text)) {
    return false;
  }
  return (
    EDIT_ANAPHORA_RE.test(text) || CURRENT_SHEET_RE.test(text) || EDIT_INSTRUCTION_RE.test(text)
  );
}

/**
 * REFINE shapes: top-N, period slice, sort, filter, or a bare re-encode. GATED on edit
 * context: a refine is claimed ONLY when the ask refers to / modifies an existing viz.
 *   • op VOCABULARY present inside a NEW-VIZ ask WITHOUT an edit signal → NOT refine (fall
 *     through to selectEligible);
 *   • otherwise → the matching refine shape;
 *   • no op vocab, but an anaphoric edit ("show that as a line") → refine-encoding.
 * Order is most-specific first (top-N and period before the broad sort/filter cues).
 */
function detectRefine(text: string): AskShape | null {
  let op: AskShape | null = null;
  if (TOP_N_RE.test(text) || /\btop-?n\b/i.test(text)) op = 'refine-top-n';
  else if (/\bq[1-4]\b/i.test(text) || /\b(?:ytd|mtd|qtd)\b/i.test(text)) op = 'refine-period';
  else if (/\bsort(?:ed)?\s+by\b|\border\s+by\b|\brank(?:ed)?\s+by\b/i.test(text))
    op = 'refine-sort';
  else if (/\bjust\b|\bonly\b|\bfilter\b|\bexclude\b|\brestrict(?:ed)?\s+to\b/i.test(text))
    op = 'refine-filter';

  const editContext = hasEditContext(text);

  if (op) {
    // Bare op vocabulary inside a NEW-VIZ ask with NO edit signal is new-viz wording — let it
    // fall through to the bind-first / selectEligible check.
    if (NEW_VIZ_RE.test(text) && !editContext) return null;
    return op;
  }

  // No explicit op vocab: a bare anaphoric EDIT of an existing viz ("show that as a line") is
  // still a refinement, never a bind-first new build.
  if (editContext) return 'refine-encoding';
  return null;
}

function decide(shape: AskShape, template: string | null, reason: string): RouteDecision {
  return { shape, route: SHAPE_ROUTE[shape], template, reason };
}

/**
 * Light normalization applied to the TEXT PASSED TO `selectEligible` — never a fork of its
 * logic, only a wrap of its input. `selectEligible` already lowercases and treats every
 * non-alphanumeric char as a token boundary; this pass collapses runs of whitespace /
 * punctuation to a single space and drops non-ASCII punctuation (em dashes, smart quotes,
 * parentheses) so a reworded-but-keyword-bearing ask matches the same templates regardless of
 * cosmetic spacing / quoting variance. Hyphens are PRESERVED (a hyphenated keyword like
 * "sorted-bar" matches hyphen-or-space either way in `phraseIndexInAsk`).
 */
export function normalizeAskForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify an ask/task text into a {shape, route}. Deterministic + model-free.
 *
 * Precedence (each earlier rule is more specific / higher-hazard than the next):
 *   1. empty       — no ask text ⇒ free (fail-open, a spec invariant).
 *   2. hazard      — sets / drilldown ⇒ scratch-pipeline (no fast-path supply).
 *   3. refine      — top-N / period / sort / filter / re-encode WITH edit context ⇒ taxonomy
 *                    label, route per SHAPE_ROUTE. Bare refine vocabulary inside a NEW-VIZ ask
 *                    (no edit signal) does NOT match here — it falls through to bind-first.
 *   4. bind-first  — `selectEligible` selects a DECISIVE, STAMPED template ⇒ bind-first.
 *   5. unmatched   — nothing selected ⇒ free.
 */
export function classifyAskRoute(
  ask: string | null | undefined,
  manifests: TemplateManifest[],
): RouteDecision {
  const text = (ask ?? '').trim();
  if (!text) return decide('empty', null, 'no ask text — fail-open to free');

  const hazard = detectHazard(text);
  if (hazard) {
    return decide(
      hazard,
      null,
      'hazard shape (set/drilldown) — no fast-path supply; route via the scratch pipeline',
    );
  }

  const refine = detectRefine(text);
  if (refine) {
    return decide(refine, null, 'refine shape (edit-context gated) — route per refine-op taxonomy');
  }

  // Wrap (never fork) selectEligible's input with a light normalization pass so a reworded,
  // keyword-bearing near-paraphrase classifies the same as the canonical ask.
  const eligible = selectEligible(normalizeAskForMatch(text), manifests, text);
  if (eligible) {
    return decide(
      'bind-first-template',
      eligible.template,
      `binder matcher selected eligible template '${eligible.template}'`,
    );
  }

  return decide('unmatched', null, 'no eligible template shape matched — free');
}
