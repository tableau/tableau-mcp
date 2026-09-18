import { cardinalityAdvice, idealCardinality, PIE_SLICE_WORKABLE_MAX } from './cardinality.js';
import type { SlotSpec } from './manifest-types.js';

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

describe('cardinality advice', () => {
  it('keeps the pie slice threshold off the quantitative wedge-size field', () => {
    expect(PIE_SLICE_WORKABLE_MAX).toBe(12);
    const wedgeSize = slot({ kind: 'quantitative-or-categorical', role: ['wedge-size'] });
    expect(idealCardinality(wedgeSize)).toBeUndefined();
    expect(cardinalityAdvice(wedgeSize, 'Business Tax Rate', 13)).toBeUndefined();
  });

  it('uses the tightest declared role band and remains advisory', () => {
    expect(idealCardinality(slot({ role: ['rows', 'color'] }))?.ideal_max).toBe(12);
    const advice = cardinalityAdvice(slot(), 'Business Tax Rate', 397);
    expect(advice).toContain('397 distinct values');
    expect(advice).toContain('not a restriction');
  });

  it('stays silent for unknown counts and member-collapsing derivations', () => {
    expect(cardinalityAdvice(slot(), 'Business Tax Rate', undefined)).toBeUndefined();
    expect(
      cardinalityAdvice(slot({ derivation: 'yr' }), 'Business Tax Rate', 1200),
    ).toBeUndefined();
  });

  it('allows high-cardinality detail while warning on color', () => {
    expect(cardinalityAdvice(slot({ kind: 'geo', role: ['lod'] }), 'Country', 208)).toBeUndefined();
    expect(cardinalityAdvice(slot({ role: ['color'] }), 'Country', 208)).toBeDefined();
  });
});
