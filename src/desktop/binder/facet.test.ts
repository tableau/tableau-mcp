// src/binder/facet.test.ts
//
// OPTIONAL SMALL-MULTIPLES FACET (W23-SM1 / W25-C), ported to tmcp.
//
// The facet is a PURELY ADDITIVE bind appended to classifyNoLlm's result: after
// the required slots fill, a spare categorical the ask NAMED is appended to the
// template's OPTIONAL facet slot (facet / facet_row / facet_col) IFF the ask
// carries explicit facet/trellis vocabulary (FACET_CUES). It never changes the
// template selection, the bound/unbound decision, or the required bindings — so a
// no-cue / no-spare ask binds byte-identically to before. Fail-closed cues: a bare
// "by <dim>" is ambiguous (could be a color encoding) and is EXCLUDED.
//
// The inline-fixture tests below prove the classify.ts feature INDEPENDENT of the
// bundled data state (see the "independent of bundled data" test). As of W27-B the
// bundled trend-line-chart / ranking-ordered-bar manifests DO carry the optional facet
// slot (facet_col / facet_row) — copied verbatim from the factory — so a final describe
// block additionally proves the SHIPPED data end-to-end via loadManifests().

import { describe, expect, it } from 'vitest';

import { classifyNoLlm } from './classify.js';
import { loadManifests } from './manifest.js';
import type { Family, SlotKind, SlotSpec, TemplateManifest } from './manifest-types.js';
import type { SchemaField, SchemaSummary } from './schema-summary.js';

// ── fixtures ────────────────────────────────────────────────────────────────
function field(
  name: string,
  role: 'dimension' | 'measure',
  type: string,
  datatype: string,
): SchemaField {
  return {
    name,
    columnName: `[${name}]`,
    role,
    type,
    datatype,
    datasource: 'DS',
    isAggregated: role === 'measure',
    column_ref: `[DS].[${name}]`,
  };
}

// Superstore-shaped summary: the canonical field names the asks below reference.
const SUMMARY: SchemaSummary = {
  datasource: 'DS',
  fields: [
    field('Region', 'dimension', 'nominal', 'string'),
    field('Category', 'dimension', 'nominal', 'string'),
    field('Sub-Category', 'dimension', 'nominal', 'string'),
    field('Order Date', 'dimension', 'ordinal', 'date'),
    field('Sales', 'measure', 'quantitative', 'real'),
    field('Profit', 'measure', 'quantitative', 'real'),
  ],
};

function slot(
  slot_id: string,
  kind: SlotKind,
  opts: { role?: string[]; required?: boolean } = {},
): SlotSpec {
  return {
    slot_id,
    template_field: slot_id,
    derivation: kind === 'quantitative' ? 'sum' : kind === 'temporal' ? 'tmn' : 'none',
    role: opts.role ?? ['rows'],
    kind,
    bindable: true,
    required: opts.required ?? true,
  };
}

/** An OPTIONAL trellis facet slot (bindable + optional + categorical, facet* on rows/cols). */
function facetSlot(slot_id: 'facet' | 'facet_row' | 'facet_col', role: string[]): SlotSpec {
  return slot(slot_id, 'categorical', { role, required: false });
}

function synth(
  template: string,
  family: Family,
  keywords: string[],
  slots: SlotSpec[],
): TemplateManifest {
  return {
    template,
    family,
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: keywords,
    description: `${family} template ${template}`,
    slots,
    calcs: [],
    hazards: [],
  };
}

function mapOf(...ms: TemplateManifest[]): Map<string, TemplateManifest> {
  return new Map(ms.map((m) => [m.template, m]));
}

/** trend-line: temporal + quantitative required, with an OPTIONAL facet_col. */
const trendLine = (): TemplateManifest =>
  synth(
    'trend-line',
    'time-series',
    ['line'],
    [
      slot('order_date', 'temporal', { role: ['cols'] }),
      slot('sales', 'quantitative', { role: ['rows'] }),
      facetSlot('facet_col', ['cols']),
    ],
  );

/** ranking bar: categorical + quantitative required, with an OPTIONAL facet_row. */
const rankBar = (): TemplateManifest =>
  synth(
    'rank-bar',
    'ranking',
    ['bar'],
    [
      slot('region', 'categorical'),
      slot('sales', 'quantitative'),
      facetSlot('facet_row', ['rows']),
    ],
  );

describe('classifyNoLlm — optional small-multiples facet (W23-SM1)', () => {
  it("arms facet_col on trend-line when the ask says 'trellis … by <dim>' + a spare categorical", () => {
    const m = mapOf(trendLine());
    const cls = classifyNoLlm('trellis line chart of Sales over Order Date by Region', m, SUMMARY);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('trend-line');
    expect(cls!.bindings).toEqual([
      { slot_id: 'order_date', field: 'Order Date' },
      { slot_id: 'sales', field: 'Sales' },
      { slot_id: 'facet_col', field: 'Region' },
    ]);
  });

  it("arms facet on the 'per <dim>' phrasing the spec names (per-category facets)", () => {
    const m = mapOf(trendLine());
    const cls = classifyNoLlm('line chart of Sales over Order Date per Region', m, SUMMARY);
    expect(cls).not.toBeNull();
    expect(cls!.bindings).toContainEqual({ slot_id: 'facet_col', field: 'Region' });
  });

  it("FAIL-CLOSED: a bare 'by <dim>' (no facet cue) does NOT facet — binding is unchanged", () => {
    const m = mapOf(trendLine());
    // Region is a NAMED spare categorical, but without an explicit facet cue the
    // ambiguous 'by Region' stays a propose-path decision → no facet appended.
    const cls = classifyNoLlm('line chart of Sales over Order Date by Region', m, SUMMARY);
    expect(cls).not.toBeNull();
    expect(cls!.bindings).toEqual([
      { slot_id: 'order_date', field: 'Order Date' },
      { slot_id: 'sales', field: 'Sales' },
    ]);
  });

  it('FAIL-CLOSED: a facet cue with NO spare categorical does not facet (never steals a slot-bound dim)', () => {
    const m = mapOf(rankBar());
    // 'small multiples' cue is present, but Region is consumed by the required
    // categorical slot and no other categorical is named → no spare → no facet.
    const cls = classifyNoLlm('small multiples bar chart of Sales by Region', m, SUMMARY);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('rank-bar');
    expect(cls!.bindings).toEqual([
      { slot_id: 'region', field: 'Region' },
      { slot_id: 'sales', field: 'Sales' },
    ]);
  });

  it('binds facet_row to the SPARE dim (Category), never the slot-bound ranked dim (Region)', () => {
    const m = mapOf(rankBar());
    const cls = classifyNoLlm(
      'bar chart of Sales by Region and Category as small multiples',
      m,
      SUMMARY,
    );
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('rank-bar');
    expect(cls!.bindings).toEqual([
      { slot_id: 'region', field: 'Region' },
      { slot_id: 'sales', field: 'Sales' },
      { slot_id: 'facet_row', field: 'Category' },
    ]);
  });

  it('inline-fixture proof: facet_col binds via an inline manifest carrying a facet slot (independent of bundled data)', () => {
    // tmcp's bundled manifests may not yet carry facet slots. Build the manifest
    // INLINE here so the classify.ts facet feature is proven regardless of the
    // bundled data state — this is the SM3 fixture-bind analog for tmcp.
    const m = mapOf(trendLine());
    const cls = classifyNoLlm(
      'small multiples line chart of Sales over Order Date by Region',
      m,
      SUMMARY,
    );
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('trend-line');
    expect(cls!.bindings).toContainEqual({ slot_id: 'facet_col', field: 'Region' });
  });

  it('the appended facet binding carries NO derivation (categorical → discrete [none:…] downstream)', () => {
    const m = mapOf(trendLine());
    const cls = classifyNoLlm('trellis line chart of Sales over Order Date by Region', m, SUMMARY);
    expect(cls).not.toBeNull();
    const facet = cls!.bindings.find((b) => b.slot_id === 'facet_col');
    // A categorical facet takes no aggregation override → the binding has ONLY
    // { slot_id, field } (no `derivation`), which the resolver renders [none:…:nk].
    expect(facet).toEqual({ slot_id: 'facet_col', field: 'Region' });
    expect(facet).not.toHaveProperty('derivation');
  });
});

// ── PRODUCT PATH: the SHIPPED bundled data (W27-B) ───────────────────────────
// The inline-fixture tests above prove the classify.ts facet CODE. This block proves
// the shipped DATA: W27-B copied the factory trend-line-chart / ranking-ordered-bar
// manifests verbatim (each carrying the optional facet_col / facet_row slot + an
// off-shelf [Facet] column decl). Loading the REAL bundled manifests (loadManifests())
// and running a trellis ask exercises the exact path a caller hits — proving the W26-D
// facet feature is now armed by the actual shipped data, not just inline fixtures.
describe('classifyNoLlm — optional facet on the SHIPPED bundled manifests (W27-B product path)', () => {
  const bundled = loadManifests();

  it('the shipped trend-line-chart / ranking-ordered-bar manifests carry the optional facet slot', () => {
    const facetCol = bundled.get('trend-line-chart')!.slots.find((s) => s.slot_id === 'facet_col');
    expect(facetCol, 'shipped trend-line-chart carries facet_col').toBeDefined();
    expect(facetCol!.required).toBe(false);
    const facetRow = bundled
      .get('ranking-ordered-bar')!
      .slots.find((s) => s.slot_id === 'facet_row');
    expect(facetRow, 'shipped ranking-ordered-bar carries facet_row').toBeDefined();
    expect(facetRow!.required).toBe(false);
  });

  it('a trellis ask binds bundled trend-line-chart WITH facet_col from the spare named categorical', () => {
    // Same trellis ask as the inline-fixture test, but against the FULL 39-manifest
    // bundled load: 'line' selects the sole fast-path-eligible time-series template
    // (trend-line-chart), the required slots take Order Date + Sales, and the explicit
    // trellis cue appends the spare NAMED categorical (Region) to the optional facet_col.
    const cls = classifyNoLlm(
      'trellis line chart of Sales over Order Date by Region',
      bundled,
      SUMMARY,
    );
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('trend-line-chart');
    expect(cls!.bindings).toEqual([
      { slot_id: 'order_date', field: 'Order Date' },
      { slot_id: 'sales', field: 'Sales' },
      { slot_id: 'facet_col', field: 'Region' },
    ]);
  });

  it("FAIL-CLOSED on shipped data: a bare 'by <dim>' (no trellis cue) binds trend-line-chart WITHOUT a facet", () => {
    // Invariant guard: the optional facet must not fire without an explicit cue, so the
    // un-faceted default render stays byte-unchanged on the shipped manifests too.
    const cls = classifyNoLlm('line chart of Sales over Order Date by Region', bundled, SUMMARY);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('trend-line-chart');
    expect(cls!.bindings).toEqual([
      { slot_id: 'order_date', field: 'Order Date' },
      { slot_id: 'sales', field: 'Sales' },
    ]);
  });
});
