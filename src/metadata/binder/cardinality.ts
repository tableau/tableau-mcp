import type { SlotSpec } from './manifest-types.js';
import type { SchemaField } from './schema-summary.js';

export interface CardinalityBand {
  ideal_max: number;
  workable_max: number;
  rationale: string;
}

export const PIE_SLICE_WORKABLE_MAX = 12;

const ROLE_BANDS: Readonly<Record<string, CardinalityBand>> = {
  color: {
    ideal_max: 12,
    workable_max: 20,
    rationale: 'one legend entry per member; beyond ~12 the colors stop being distinguishable',
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

const BANDED_KINDS: ReadonlySet<string> = new Set([
  'categorical',
  'geo',
  'temporal',
  'quantitative-or-categorical',
]);
const MEMBER_PRESERVING_DERIVATIONS: ReadonlySet<string> = new Set(['none', 'attr']);

export function idealCardinality(slot: SlotSpec): CardinalityBand | undefined {
  if (!slot.bindable || !BANDED_KINDS.has(slot.kind)) return undefined;
  let tightest: CardinalityBand | undefined;
  for (const role of slot.role) {
    const band = ROLE_BANDS[role];
    if (band && (!tightest || band.ideal_max < tightest.ideal_max)) tightest = band;
  }
  return tightest;
}

export function cardinalityAdvice(
  slot: SlotSpec,
  field: SchemaField,
  effectiveDerivation: string = slot.derivation,
): string | undefined {
  const band = idealCardinality(slot);
  if (
    !band ||
    !MEMBER_PRESERVING_DERIVATIONS.has(effectiveDerivation) ||
    field.approxCount === undefined ||
    field.approxCount <= band.ideal_max
  ) {
    return undefined;
  }

  const severity =
    field.approxCount > band.workable_max ? 'far more than' : 'more than the ideal for';
  return (
    `slot '${slot.slot_id}' has ${field.approxCount} distinct values in "${field.name}" — ` +
    `${severity} this slot's ideal of ~${band.ideal_max} (${band.rationale}). ` +
    'This is a legibility hint, not a restriction: keep the bind if the density is intended, ' +
    'or choose a lower-cardinality field or a template that summarizes instead.'
  );
}
