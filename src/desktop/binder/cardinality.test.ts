import { cardinalityAdvice, idealCardinality } from './cardinality.js';
import { loadManifests } from './manifest.js';
import type { SlotSpec } from './manifest-types.js';
import { type SchemaField, summarizeSchema } from './schema-summary.js';
import { validateBinding } from './validate.js';

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

describe('idealCardinality — the band comes from the slot, not the field', () => {
  it('takes the MOST CONSTRAINING band when a slot declares several roles', () => {
    // rows is 25, color is 12; one member count feeds both, so the tighter wins.
    const band = idealCardinality(slot({ role: ['rows', 'color'] }));
    expect(band?.ideal_max).toBe(12);
  });

  it('gives a detail/lod slot a permissive band — a mark is not a label', () => {
    expect(idealCardinality(slot({ role: ['lod'], kind: 'geo' }))?.ideal_max).toBe(1000);
    expect(idealCardinality(slot({ role: ['detail'] }))?.ideal_max).toBe(1000);
  });

  it('stays silent for a measure slot, where member count is not the constraint', () => {
    expect(idealCardinality(slot({ kind: 'quantitative', role: ['rows'] }))).toBeUndefined();
  });

  it('stays silent for a non-bindable slot the template owns outright', () => {
    expect(idealCardinality(slot({ bindable: false }))).toBeUndefined();
  });

  it('stays silent for a role it has no opinion about rather than inventing a band', () => {
    expect(idealCardinality(slot({ role: ['formula-input'] }))).toBeUndefined();
  });
});

describe('cardinalityAdvice — advisory only, and measured not guessed', () => {
  it('fires on the tbm-test repro: 397 distinct strings on a categorical rows slot', () => {
    const advice = cardinalityAdvice(slot(), field({ approxCount: 397 }));
    expect(advice).toContain('397 distinct values in "Business Tax Rate"');
    expect(advice).toContain('~25');
    // The whole point of the user's direction: the agent keeps the decision.
    expect(advice).toContain('not a restriction');
  });

  it('says nothing when the connection publishes no distinct-count', () => {
    // A live connection often ships no <approx-count>. Absent means UNKNOWN — guessing
    // cardinality from the field name is exactly what this design refuses to do.
    expect(cardinalityAdvice(slot(), field())).toBeUndefined();
  });

  it('says nothing when the field fits the band', () => {
    expect(cardinalityAdvice(slot(), field({ name: 'Region', approxCount: 6 }))).toBeUndefined();
  });

  it('escalates the wording past the workable ceiling but still permits the bind', () => {
    const advice = cardinalityAdvice(slot({ role: ['color'] }), field({ approxCount: 208 }));
    expect(advice).toContain('far more than');
    expect(advice).toContain('legibility hint');
  });

  it('accepts 208 countries on a map lod slot that would be flagged on color', () => {
    const geoSlot = slot({ slot_id: 'country', kind: 'geo', role: ['lod'] });
    const countries = field({ name: 'Country/Region', approxCount: 208 });
    expect(cardinalityAdvice(geoSlot, countries)).toBeUndefined();
    expect(cardinalityAdvice(slot({ role: ['color'] }), countries)).toBeDefined();
  });
});

describe('idealCardinality — every shipped manifest slot', () => {
  it('produces a band whose ideal never exceeds its workable ceiling', () => {
    const manifests = loadManifests();
    let banded = 0;
    for (const m of manifests.values()) {
      for (const s of m.slots) {
        const band = idealCardinality(s);
        if (!band) continue;
        banded++;
        expect(band.ideal_max).toBeLessThanOrEqual(band.workable_max);
        expect(band.rationale.length).toBeGreaterThan(0);
      }
    }
    // Guards against the band table silently going dark (e.g. a role rename upstream).
    expect(banded).toBeGreaterThan(0);
  });
});

describe("cardinality end-to-end — Tableau's own <approx-count> reaches the bind warning", () => {
  // The tbm-test.pptx shape: World Indicators as an EXTRACT, which is why the counts
  // exist at all (live connections often publish none). [Business Tax Rate] is a string
  // dimension with 397 distinct values — perfectly legal on a categorical slot, and
  // perfectly illegible as 397 bars. Counts are the real measured values.
  const WORLD_INDICATORS = `<?xml version='1.0'?>
<workbook>
  <datasources>
    <datasource inline='true' name='World Indicators'>
      <connection>
        <relation />
        <metadata-records>
          <metadata-record class='column'>
            <local-name>[Business Tax Rate]</local-name>
            <local-type>string</local-type>
            <approx-count>397</approx-count>
          </metadata-record>
          <metadata-record class='column'>
            <local-name>[Region]</local-name>
            <local-type>string</local-type>
            <approx-count>6</approx-count>
          </metadata-record>
          <metadata-record class='column'>
            <local-name>[Birth Rate]</local-name>
            <local-type>real</local-type>
            <approx-count>47</approx-count>
          </metadata-record>
        </metadata-records>
      </connection>
      <column datatype='string' name='[Business Tax Rate]' role='dimension' type='nominal' />
      <column datatype='string' name='[Region]' role='dimension' type='nominal' />
      <column datatype='real' name='[Birth Rate]' role='measure' type='quantitative' />
    </datasource>
  </datasources>
  <worksheets />
  <windows />
</workbook>`;

  const schema = (): ReturnType<typeof summarizeSchema> => summarizeSchema(WORLD_INDICATORS);

  it('carries approx-count onto SchemaField even when a top-level column wins the dedupe', () => {
    // Regression guard for the reason this is a SEPARATE index: all three fields have a
    // top-level <column>, so reading the count off the deduped winner would lose every one.
    const byName = new Map(schema().fields.map((f) => [f.name, f]));
    expect(byName.get('Business Tax Rate')?.approxCount).toBe(397);
    expect(byName.get('Region')?.approxCount).toBe(6);
    expect(byName.get('Birth Rate')?.approxCount).toBe(47);
  });

  it('warns — and still BINDS — the 397-member field the agent originally chose', () => {
    const m = loadManifests().get('magnitude-simple-bar')!;
    const result = validateBinding(
      m,
      {
        template: 'magnitude-simple-bar',
        title: 'Birth Rate by Business Tax Rate',
        bindings: [
          { slot_id: 'category', field: 'Business Tax Rate' },
          { slot_id: 'measure', field: 'Birth Rate' },
        ],
      },
      schema(),
    );

    // The bind SUCCEEDS. This is the user's explicit direction: hint the ideal
    // cardinality, leave the agent room to use the template anyway.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected the high-cardinality bind to remain allowed');
    expect(result.warnings?.join('\n')).toContain('397 distinct values');
    expect(result.warnings?.join('\n')).toContain('not a restriction');
  });

  it('is silent on the well-chosen 6-member bind', () => {
    const m = loadManifests().get('magnitude-simple-bar')!;
    const result = validateBinding(
      m,
      {
        template: 'magnitude-simple-bar',
        title: 'Birth Rate by Region',
        bindings: [
          { slot_id: 'category', field: 'Region' },
          { slot_id: 'measure', field: 'Birth Rate' },
        ],
      },
      schema(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a clean bind');
    expect(result.warnings ?? []).toEqual([]);
  });
});

describe('cardinalityAdvice — member-collapsing derivations suppress a false positive', () => {
  it('does not flag a 1200-day date field on a year-truncated axis', () => {
    // 21 of 22 shipped temporal slots truncate the date. ~1,200 distinct days renders
    // ~4 year ticks, so comparing the raw count would flag nearly every date bind.
    const yearAxis = slot({ slot_id: 'order_date', kind: 'temporal', derivation: 'yr' });
    const orderDate = field({ name: 'Order Date', datatype: 'date', approxCount: 1200 });
    expect(cardinalityAdvice(yearAxis, orderDate)).toBeUndefined();
  });

  it('still flags a raw date axis at derivation none, where each day IS a tick', () => {
    const rawAxis = slot({ slot_id: 'order_date', kind: 'temporal', derivation: 'none' });
    const orderDate = field({ name: 'Order Date', datatype: 'date', approxCount: 1200 });
    expect(cardinalityAdvice(rawAxis, orderDate)).toContain('1200 distinct values');
  });

  it('does not flag a SUMMED measure on color — a ramp, not one legend entry per row', () => {
    // The symbol-map color/tooltip slots are quantitative-or-categorical at sum.
    const colorSum = slot({
      slot_id: 'color',
      kind: 'quantitative-or-categorical',
      role: ['color'],
      derivation: 'sum',
    });
    const sales = field({ name: 'Sales', role: 'measure', datatype: 'real', approxCount: 1605 });
    expect(cardinalityAdvice(colorSum, sales)).toBeUndefined();
  });

  it('keeps the band visible for discovery even where the comparison is suppressed', () => {
    // list-templates still advertises the axis band on a date-truncating slot: the band
    // describes the rendered axis, which is real. Only the raw-count COMPARISON is
    // gated. This pins the two behaviors as decoupled.
    const yearAxis = slot({ slot_id: 'order_date', kind: 'temporal', derivation: 'yr' });
    expect(idealCardinality(yearAxis)?.ideal_max).toBe(25);
    expect(cardinalityAdvice(yearAxis, field({ approxCount: 1200 }))).toBeUndefined();
  });
});
