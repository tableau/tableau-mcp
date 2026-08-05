// src/desktop/binder/cardinality.ts
//
// The ADVISORY ideal-cardinality hint: how many distinct members a slot can carry
// before the chart stops communicating, derived mechanically from the slot's own
// declared `role` + `kind`, and compared against Tableau's own measured
// distinct-count (`SchemaField.approxCount`, from `<metadata-record><approx-count>`).
//
// WHY THIS EXISTS. The tbm-test.pptx repro bound `[Business Tax Rate]` (397 distinct
// string members) to a categorical rows slot. Nothing was invalid — it is a string
// dimension on a slot that accepts string dimensions — so no gate fired, and the
// result was a bar chart with 397 unreadable bars. The failure is legibility, not
// legality.
//
// THIS IS DELIBERATELY NOT A GATE. Every function here produces a hint or a warning
// and NOTHING here can block a bind. A high-cardinality bind is sometimes exactly
// what the caller wants (a 200-country choropleth is fine; a 200-country bar chart
// is not), and the band is a heuristic about human legibility, not a fact about the
// data. So the agent is told what is likely ideal and keeps the decision — it may
// read the hint, disagree, and use the template anyway.
//
// MEASURED, NOT GUESSED. The comparison uses Tableau's own estimate. When the
// connection publishes no `<approx-count>` (common on live connections; extracts
// carry them) `approxCount` is undefined and we emit NOTHING rather than falling
// back to guessing cardinality from a field's name — a name-based guess got the
// World Indicators fields right only by luck and would misfire elsewhere.

import type { SlotSpec } from './manifest-types.js';
import type { SchemaField } from './schema-summary.js';

/** The advisory band for one slot: distinct-member counts that stay legible. */
export interface CardinalityBand {
  /** Distinct members at or below which the slot reads well. */
  ideal_max: number;
  /** Above this, the encoding is very likely illegible — still never blocked. */
  workable_max: number;
  /** Why this slot has this band, in terms of what the member count produces. */
  rationale: string;
}

/**
 * Per-role bands. The unit is what ONE distinct member costs the reader in that
 * structural position, which is why the numbers differ by two orders of magnitude:
 * a member on `color` is a legend entry a human must visually match, while a member
 * on `lod`/`detail` is just one more mark in a cloud and costs nothing to read.
 *
 * Roles absent from this table (formula-input, calc-input, sort-measure,
 * dual-axis-measure, measure-values, reference-line, tooltip) get no band — they are
 * structural or measure-valued positions where distinct-member count is not the
 * legibility constraint.
 */
const ROLE_BANDS: Readonly<Record<string, CardinalityBand>> = {
  color: {
    ideal_max: 12,
    workable_max: 20,
    rationale: 'one legend entry per member; beyond ~12 the colors stop being distinguishable',
  },
  'wedge-size': {
    ideal_max: 8,
    workable_max: 12,
    rationale: 'one wedge per member; a pie with many thin slices cannot be compared',
  },
  rows: {
    ideal_max: 25,
    workable_max: 50,
    rationale: 'one axis tick / row per member; beyond ~25 the labels crowd and the chart scrolls',
  },
  cols: {
    ideal_max: 25,
    workable_max: 50,
    rationale:
      'one axis tick / column per member; beyond ~25 the labels crowd and the chart scrolls',
  },
  text: {
    ideal_max: 25,
    workable_max: 50,
    rationale: 'one text row per member; a long table is read, not seen',
  },
  'sort-dimension': {
    ideal_max: 25,
    workable_max: 50,
    rationale: 'sorting orders the axis members, so it inherits the axis crowding limit',
  },
  size: {
    ideal_max: 25,
    workable_max: 50,
    rationale: 'one sized mark per member; many marks makes size differences unreadable',
  },
  filter: {
    ideal_max: 50,
    workable_max: 200,
    rationale: 'one entry per member in the filter control; a very long list is hard to navigate',
  },
  detail: {
    ideal_max: 1000,
    workable_max: 5000,
    rationale: 'one mark per member with no label, so high cardinality is expected here',
  },
  lod: {
    ideal_max: 1000,
    workable_max: 5000,
    rationale: 'sets the mark grain rather than a label, so high cardinality is expected here',
  },
};

/** Kinds whose distinct-member count drives legibility. A measure slot has none. */
const BANDED_KINDS: ReadonlySet<string> = new Set([
  'categorical',
  'geo',
  'temporal',
  'quantitative-or-categorical',
]);

/**
 * The advisory band for a slot: the MOST CONSTRAINING band among its declared roles.
 * A slot on both `rows` and `color` must satisfy the tighter of the two, because the
 * member count is one number feeding both encodings at once.
 *
 * Returns undefined when the slot is not bindable, is not a member-counted kind, or
 * declares no role this table has an opinion about — silence beats a fabricated band.
 */
export function idealCardinality(slot: SlotSpec): CardinalityBand | undefined {
  if (!slot.bindable) return undefined;
  if (!BANDED_KINDS.has(slot.kind)) return undefined;

  let tightest: CardinalityBand | undefined;
  for (const role of slot.role) {
    const band = ROLE_BANDS[role];
    if (!band) continue;
    if (!tightest || band.ideal_max < tightest.ideal_max) tightest = band;
  }
  return tightest;
}

/**
 * Derivations that COLLAPSE a field's distinct members, making the raw
 * `<approx-count>` incomparable to the band.
 *
 * Two false-positive classes this suppresses, both real in the shipped manifests:
 *   • Date truncation — 21 of 22 temporal slots carry `yr`/`mn`/`tmn`/`tqr`/`tdy`,
 *     so an Order Date with ~1,200 distinct days renders ~4 year ticks. Comparing
 *     1,200 against the axis band would flag every date bind on every template.
 *   • Aggregation — the symbol-map `color`/`tooltip` slots are
 *     `quantitative-or-categorical` at `sum`. A summed measure on color is a
 *     continuous ramp, not one legend entry per input row.
 *
 * `none` and `attr` pass members through unchanged and are the only derivations for
 * which the distinct count IS the mark/tick/legend count.
 */
const MEMBER_PRESERVING_DERIVATIONS: ReadonlySet<string> = new Set(['none', 'attr']);

/**
 * One advisory sentence when a bound field's MEASURED distinct count exceeds the
 * slot's band, or undefined when it fits / either number is unknown / the slot's
 * derivation collapses members so the count is not what the reader sees.
 *
 * The wording names the numbers and the consequence, then states plainly that the
 * bind is allowed — the caller is choosing, not being corrected.
 */
export function cardinalityAdvice(slot: SlotSpec, f: SchemaField): string | undefined {
  const band = idealCardinality(slot);
  if (!band) return undefined;
  // A truncated date or an aggregated measure shows FEWER marks than the field has
  // distinct values, so the raw count says nothing about legibility here.
  if (!MEMBER_PRESERVING_DERIVATIONS.has(slot.derivation)) return undefined;
  // Absent ⇒ unknown, never "low". Say nothing rather than guess.
  if (f.approxCount === undefined) return undefined;
  if (f.approxCount <= band.ideal_max) return undefined;

  const severity = f.approxCount > band.workable_max ? 'far more than' : 'more than the ideal for';
  return (
    `slot '${slot.slot_id}' has ${f.approxCount} distinct values in "${f.name}" — ` +
    `${severity} this slot's ideal of ~${band.ideal_max} (${band.rationale}). ` +
    'This is a legibility hint, not a restriction: keep the bind if the density is intended, ' +
    'or choose a lower-cardinality field or a template that summarizes instead.'
  );
}
