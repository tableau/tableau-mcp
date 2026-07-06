// src/binder/within-family-disambiguation.test.ts
//
// STAGE 2b WITHIN-FAMILY DISAMBIGUATION (measured scale breakpoints). Two rules
// added to classifyNoLlm's template selection, each pinned here:
//
//   (1) INTRA-FAMILY TIEBREAK — a keyword-argmax tie whose tied candidates ALL
//       share one family is unambiguous at the family level, so instead of failing
//       closed we bind: rank the slot-satisfiable candidates by keyword specificity
//       (longer/multi-token matches first), break remaining ties by template name,
//       and take the top. A tie that SPANS families stays fail-closed (propose).
//       This recovers the no-LLM hit rate that collapsed to 0 once a family held
//       >1 fast-path template (every intra-family tie used to fail closed).
//
//   (2) SOLE-WRONG-MATCHER GUARD — a lone keyword winner may auto-bind ONLY if at
//       least one keyword it matched is FAMILY-NATIVE (carried by a strict majority
//       of its own family's eligible templates). A template that is the SOLE matcher
//       of a keyword it merely BORROWED from another family (that borrowed keyword is
//       in only one of its family's members → not native) demotes to propose. This
//       kills the ramp-up wrong-family bind measured at 10-40%.

import { describe, expect, it } from 'vitest';

import { classifyNoLlm } from './classify.js';
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
    field('Customer Name', 'dimension', 'nominal', 'string'),
    field('Country/Region', 'dimension', 'nominal', 'string'),
    field('State/Province', 'dimension', 'nominal', 'string'),
    field('Order Date', 'dimension', 'ordinal', 'date'),
    field('Sales', 'measure', 'quantitative', 'real'),
    field('Profit', 'measure', 'quantitative', 'real'),
  ],
};

function slot(slot_id: string, kind: SlotKind): SlotSpec {
  return {
    slot_id,
    template_field: slot_id,
    derivation: kind === 'quantitative' ? 'sum' : kind === 'temporal' ? 'tmn' : 'none',
    role: ['rows'],
    kind,
    bindable: true,
    required: true,
  };
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

const catVal = (): SlotSpec[] => [slot('cat', 'categorical'), slot('val', 'quantitative')];

// ── (1) INTRA-FAMILY TIEBREAK ─────────────────────────────────────────────────
describe('classifyNoLlm — intra-family tiebreak', () => {
  it('binds a family-correct representative instead of failing closed on an intra-family tie', () => {
    // Two ranking templates, identical keyword ("bar") + slots → a within-family
    // tie. Old code returned null (fail closed); now it binds a representative.
    const m = mapOf(
      synth('rank-a', 'ranking', ['bar'], catVal()),
      synth('rank-b', 'ranking', ['bar'], catVal()),
    );
    const res = classifyNoLlm('bar chart of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(m.get(res!.template)!.family).toBe('ranking');
    // Deterministic representative: lexicographically-first template name.
    expect(res!.template).toBe('rank-a');
    expect(res!.bindings).toEqual([
      { slot_id: 'cat', field: 'Region' },
      { slot_id: 'val', field: 'Sales' },
    ]);
  });

  it('recovers the hit that a >1-member family used to lose (3 identical synth members)', () => {
    const m = mapOf(
      synth('rank-1', 'ranking', ['bar'], catVal()),
      synth('rank-2', 'ranking', ['bar'], catVal()),
      synth('rank-3', 'ranking', ['bar'], catVal()),
    );
    const res = classifyNoLlm('bar chart of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(m.get(res!.template)!.family).toBe('ranking');
  });

  it('prefers the more SPECIFIC (multi-token) keyword match within the tied family', () => {
    // Both score 1 on the ask ("bar" is a whole token inside "column-bar"), but
    // "column-bar" is a 2-token keyword → more specific → wins.
    const m = mapOf(
      synth('rank-generic', 'ranking', ['bar'], catVal()),
      synth('rank-specific', 'ranking', ['column-bar'], catVal()),
    );
    const res = classifyNoLlm('column-bar of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('rank-specific');
  });

  it('fails closed (propose) on a CROSS-family tie', () => {
    // "bar" matched by a ranking template AND a part-to-whole template that
    // borrowed it → tied set spans two families → genuinely ambiguous → null.
    const m = mapOf(
      synth('rank', 'ranking', ['bar'], catVal()),
      synth('p2w-borrow', 'part-to-whole', ['treemap', 'bar'], catVal()),
    );
    expect(classifyNoLlm('bar chart of Sales by Region', m, SUMMARY)).toBeNull();
  });

  it("proposes when NO tied candidate's required slots are satisfiable by the ask's fields", () => {
    // Both ranking templates need a temporal slot the ask can't fill (no date named).
    const tempVal = (): SlotSpec[] => [slot('t', 'temporal'), slot('v', 'quantitative')];
    const m = mapOf(
      synth('rank-a', 'ranking', ['bar'], tempVal()),
      synth('rank-b', 'ranking', ['bar'], tempVal()),
    );
    expect(classifyNoLlm('bar chart of Sales by Region', m, SUMMARY)).toBeNull();
  });
});

// ── (2) SOLE-WRONG-MATCHER GUARD ──────────────────────────────────────────────
describe('classifyNoLlm — sole-wrong-matcher guard', () => {
  it('demotes a lone matcher that won only on a BORROWED (non-family-native) keyword', () => {
    // part-to-whole family = {treemap-real, p2w-borrow}. "magnitude" is carried by
    // only ONE of the two → not family-native → the sole "magnitude" match proposes
    // instead of binding the wrong (part-to-whole) family.
    const m = mapOf(
      synth('treemap-real', 'part-to-whole', ['treemap', 'part-to-whole', 'share'], catVal()),
      synth('p2w-borrow', 'part-to-whole', ['treemap', 'part-to-whole', 'magnitude'], catVal()),
    );
    expect(classifyNoLlm('magnitude of Sales by Region', m, SUMMARY)).toBeNull();
  });

  it('still binds a lone matcher whose winning keyword IS family-native (single-member family)', () => {
    // correlation has one eligible member → all its keywords are native → the sole
    // "scatter" match binds (guard must not block a legitimate lone matcher).
    const m = mapOf(
      synth(
        'scatter',
        'correlation',
        ['scatter', 'correlation'],
        [slot('x', 'quantitative'), slot('y', 'quantitative'), slot('detail', 'categorical')],
      ),
    );
    const res = classifyNoLlm('scatter of Sales and Profit by Customer Name', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('scatter');
    expect(m.get(res!.template)!.family).toBe('correlation');
  });

  it("binds a lone matcher won on a keyword shared across the family's fast-path templates", () => {
    // "treemap" is carried by BOTH part-to-whole members → family-native → the lone
    // "treemap" matcher (the other member does NOT match this ask) binds.
    const m = mapOf(
      synth('treemap-a', 'part-to-whole', ['treemap', 'share'], catVal()),
      // second member also carries "treemap" (native) but is only reachable via
      // "mosaic"; the ask says "treemap", matched by treemap-a alone.
      synth('mosaic-b', 'part-to-whole', ['mosaic', 'treemap'], catVal()),
    );
    // Ask names "treemap": BOTH members carry "treemap" → this is a tie, not a lone
    // matcher; the intra-family tiebreak binds a part-to-whole representative.
    const res = classifyNoLlm('treemap of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(m.get(res!.template)!.family).toBe('part-to-whole');
  });
});

// ── (3) LONGEST-FIRST FIELD MASKING (compound-name fragmentation) ─────────────
// SUMMARY lists "Region" BEFORE "Country/Region". Schema-order masking would mask
// "Region" first, fragmenting "Country/Region" -> "Country/      " and leaking a
// "Country" token; longest-first masking consumes the whole compound token first.
describe('classifyNoLlm — longest-first field masking', () => {
  it("fully masks a compound field so a sub-token can't score a template by field NAME", () => {
    // Template selected purely on a "country" keyword. The ask carries NO chart
    // keyword — only the FIELD "Country/Region". Under the schema-order bug the
    // leaked "Country" token would score this template (a field name driving
    // selection); longest-first masking removes the whole field name -> no match.
    const m = mapOf(synth('geo-kw', 'spatial', ['country'], catVal()));
    expect(classifyNoLlm('chart of Sales by Country/Region', m, SUMMARY)).toBeNull();
  });

  it('still selects on a genuine chart keyword after masking (masking removed only the field-name leak)', () => {
    const m = mapOf(synth('choropleth', 'spatial', ['choropleth'], catVal()));
    const res = classifyNoLlm('choropleth of Sales by Country/Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('choropleth');
  });
});

// ── (4) GEO SLOT ↔ FIELD NAME AFFINITY (fail-closed geo binding) ──────────────
const geoTriple = (): SlotSpec[] => [
  slot('country', 'geo'),
  slot('state', 'geo'),
  slot('val', 'quantitative'),
];

describe('classifyNoLlm — geo slot name affinity', () => {
  it('binds country->Country/Region, state->State/Province, val->Profit (correct, not swapped)', () => {
    const m = mapOf(synth('choropleth', 'spatial', ['choropleth'], geoTriple()));
    const res = classifyNoLlm(
      'choropleth of Profit by State/Province within Country/Region',
      m,
      SUMMARY,
    );
    expect(res).not.toBeNull();
    expect(res!.bindings).toEqual([
      { slot_id: 'country', field: 'Country/Region' },
      { slot_id: 'state', field: 'State/Province' },
      { slot_id: 'val', field: 'Profit' },
    ]);
  });

  it('SWAP REFUSAL: binds by name regardless of field order in the ask', () => {
    // State/Province is named BEFORE Country/Region; the OLD first-unused-dimension
    // geo rule would bind country<-State/Province (a silent swap). Affinity binds
    // by name, so the mapping is correct no matter the order.
    const m = mapOf(synth('choropleth', 'spatial', ['choropleth'], geoTriple()));
    const res = classifyNoLlm(
      'choropleth of Sales by State/Province and Country/Region',
      m,
      SUMMARY,
    );
    expect(res).not.toBeNull();
    expect(res!.bindings.find((b) => b.slot_id === 'country')!.field).toBe('Country/Region');
    expect(res!.bindings.find((b) => b.slot_id === 'state')!.field).toBe('State/Province');
  });

  it('AMBIGUOUS -> propose: a geo slot with 2+ affinity candidates fails closed', () => {
    // Only Country/Region is named; the state slot's affinity (state/province/region)
    // ties Country/Region (via 'region') against the phantom 'Region' sub-token ->
    // no unique max -> null (propose) rather than a guessed bind.
    const m = mapOf(synth('choropleth', 'spatial', ['choropleth'], geoTriple()));
    expect(classifyNoLlm('choropleth of Profit across Country/Region', m, SUMMARY)).toBeNull();
  });

  it('ZERO candidates -> propose: a geo slot with no name-affinity field fails closed', () => {
    const m = mapOf(synth('choropleth', 'spatial', ['choropleth'], geoTriple()));
    // 'Category' carries no country/state token -> country slot has 0 candidates.
    expect(classifyNoLlm('choropleth of Sales by Category', m, SUMMARY)).toBeNull();
  });

  it('resolves COMPOUND geo slot_ids by primary concept (country_region -> country, not country∪state)', () => {
    // The distribution-bar-code-chart shape: geo slot_ids 'country_region' /
    // 'state_province'. Naively unioning both tokens' synonyms would make
    // State/Province tie country_region; primary-concept resolution keeps it clean.
    const m = mapOf(
      synth(
        'strip',
        'distribution',
        ['strip-plot'],
        [
          slot('cat', 'categorical'),
          slot('val', 'quantitative'),
          slot('country_region', 'geo'),
          slot('state_province', 'geo'),
        ],
      ),
    );
    const res = classifyNoLlm(
      'strip-plot of Sales by Sub-Category, one tick per State/Province and Country/Region',
      m,
      SUMMARY,
    );
    expect(res).not.toBeNull();
    const byId = Object.fromEntries(res!.bindings.map((b) => [b.slot_id, b.field]));
    expect(byId.country_region).toBe('Country/Region');
    expect(byId.state_province).toBe('State/Province');
  });
});

// ── (5) PLURAL CHART-NOUN BOUNDARY (FS4b) ─────────────────────────────────────
// phraseIndexInAsk tolerates a trailing plural `s` on the FINAL token of a keyword
// phrase, but ONLY when that final token is a chart noun (bar→bars, column→columns,
// map→maps, stacked-bar→stacked bars). Non-noun keywords get NO plural tolerance,
// so matching is not broadened for them. Evidence asks: R008/R043 (stacked bars),
// R020 (Maps).
describe('classifyNoLlm — plural chart-noun boundary', () => {
  it('binds when the ask pluralizes a single-token chart noun ("bars" → "bar")', () => {
    const m = mapOf(synth('rank', 'ranking', ['bar'], catVal()));
    const res = classifyNoLlm('bars of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('rank');
  });

  it('binds when the ask pluralizes the FINAL token of a multi-token chart noun ("stacked bars" → "stacked-bar")', () => {
    const m = mapOf(synth('p2w', 'part-to-whole', ['stacked-bar'], catVal()));
    const res = classifyNoLlm('Stacked bars of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('p2w');
  });

  it('binds when the ask pluralizes the "map" chart noun ("Maps" → "map")', () => {
    const m = mapOf(synth('geo', 'spatial', ['map'], catVal()));
    const res = classifyNoLlm('Maps of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('geo');
  });

  it('does NOT grant plural tolerance to a non-chart-noun keyword ("trends" ≠ "trend")', () => {
    const m = mapOf(synth('ts', 'time-series', ['trend'], catVal()));
    expect(classifyNoLlm('trends of Sales by Region', m, SUMMARY)).toBeNull();
  });

  it('leaves an exact singular chart-noun match unchanged', () => {
    const m = mapOf(synth('rank', 'ranking', ['bar'], catVal()));
    const res = classifyNoLlm('bar chart of Sales by Region', m, SUMMARY);
    expect(res).not.toBeNull();
    expect(res!.template).toBe('rank');
  });

  it('tolerates ONLY a trailing +s, not a fuzzy prefix ("bare" ≠ "bar")', () => {
    // Guards against over-broadening: the plural rule appends an optional `s`, so a
    // longer word that merely starts with the noun ("bare") must still fail closed.
    const m = mapOf(synth('rank', 'ranking', ['bar'], catVal()));
    expect(classifyNoLlm('bare of Sales by Region', m, SUMMARY)).toBeNull();
  });
});

// ── determinism ───────────────────────────────────────────────────────────────
describe('classifyNoLlm — determinism', () => {
  it('same inputs produce identical selection + bindings', () => {
    const build = (): Map<string, TemplateManifest> =>
      mapOf(
        synth('rank-a', 'ranking', ['bar'], catVal()),
        synth('rank-b', 'ranking', ['bar'], catVal()),
        synth('rank-c', 'ranking', ['bar'], catVal()),
      );
    const a = classifyNoLlm('bar chart of Sales by Region', build(), SUMMARY);
    const b = classifyNoLlm('bar chart of Sales by Region', build(), SUMMARY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
