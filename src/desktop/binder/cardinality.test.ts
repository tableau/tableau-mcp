import { cardinalityAdvice, idealCardinality, PIE_SLICE_WORKABLE_MAX } from './cardinality.js';
import type { SlotSpec } from './manifest-types.js';
import type { SchemaField } from './schema-summary.js';

const slot = (over: Partial<SlotSpec> = {}): SlotSpec => ({
  slot_id: 'category',
  template_field: '{{field_base_1}}',
  derivation: 'none',
  role: ['rows'],
  kind: 'categorical',
  bindable: true,
  required: true,
  ...over,
});

const field = (over: Partial<SchemaField> = {}): SchemaField => ({
  name: 'Business Tax Rate',
  columnName: '[Business Tax Rate]',
  role: 'dimension',
  type: 'nominal',
  datatype: 'string',
  datasource: 'World Indicators',
  isAggregated: false,
  column_ref: '[World Indicators].[none:Business Tax Rate:nk]',
  ...over,
});

describe('cardinality advice', () => {
  it('exports the pie slice workable boundary used by binding validation', () => {
    expect(PIE_SLICE_WORKABLE_MAX).toBe(12);
    expect(idealCardinality(slot({ role: ['wedge-size'] }))?.workable_max).toBe(
      PIE_SLICE_WORKABLE_MAX,
    );
  });

  it('uses the tightest declared role band and remains advisory', () => {
    expect(idealCardinality(slot({ role: ['rows', 'color'] }))?.ideal_max).toBe(12);
    const advice = cardinalityAdvice(slot(), field({ approxCount: 397 }));
    expect(advice).toContain('397 distinct values');
    expect(advice).toContain('not a restriction');
  });

  it('stays silent for unknown counts and member-collapsing derivations', () => {
    expect(cardinalityAdvice(slot(), field())).toBeUndefined();
    expect(
      cardinalityAdvice(slot({ derivation: 'yr' }), field({ approxCount: 1200 })),
    ).toBeUndefined();
  });

  it('allows high-cardinality detail while warning on color', () => {
    const countries = field({ name: 'Country', approxCount: 208 });
    expect(cardinalityAdvice(slot({ kind: 'geo', role: ['lod'] }), countries)).toBeUndefined();
    expect(cardinalityAdvice(slot({ role: ['color'] }), countries)).toBeDefined();
  });
});
