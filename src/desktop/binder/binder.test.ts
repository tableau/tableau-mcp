import { beforeAll, describe, expect, it } from 'vitest';

import {
  type BindingProposal,
  bindTemplate,
  buildLlmInput,
  classifyNoLlm,
  MAX_CLASSIFIABLE_FIELDS,
  PROPOSAL_OUTPUT_SCHEMA,
  type SchemaSummary,
  summarizeSchema,
  TITLE_CONTROL_CHAR_RE,
} from './binder.js';
import { loadManifests } from './manifest.js';
import type { Family, TemplateManifest } from './manifest-types.js';

// Minimal Superstore-shaped workbook: workbook-level <datasources> is what
// listAvailableFields reads (top-level <column> with role/type/datatype).
const WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Sub-Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Customer Name]' role='dimension' type='nominal' datatype='string' />
      <column name='[Country/Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[State/Province]' role='dimension' type='nominal' datatype='string' />
      <column name='[Order Date]' role='dimension' type='ordinal' datatype='date' />
      <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
      <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

const COUNTRY_ONLY_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Football'>
      <column name='[Country]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[Name]' />
      <column name='[Goals For]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;

const COUNTRY_ONLY_DUPLICATE_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Football'>
      <column name='[Country]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[Name]' />
      <column name='[Country1]' role='dimension' type='nominal' datatype='string' />
      <column name='[Goals For]' role='measure' type='quantitative' datatype='integer' />
      <column name='[Goals For1]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;

let manifests: Map<string, TemplateManifest>;
beforeAll(() => {
  manifests = loadManifests();
});

// The evidence gate (attacks 5+10) shrinks fast_path_eligible to the 4 render-
// verified templates. A few orchestrator behaviors below depend on a template-owned
// calc (scatter) or avoid_when guidance (pie) — features the render-verified
// eligible-4 do NOT carry. To exercise those code paths in isolation from the
// (separately asserted) eligibility shrink, force the named templates eligible in a
// cloned manifest map. This does not weaken the gate: the gate itself is proven by
// manifest.test.ts and the "not-fast-path" test below.
function withForcedEligible(names: string[]): Map<string, TemplateManifest> {
  const out = new Map<string, TemplateManifest>();
  for (const [k, v] of loadManifests()) {
    out.set(
      k,
      names.includes(k)
        ? {
            ...v,
            fast_path_eligible: true,
            portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
          }
        : v,
    );
  }
  return out;
}

describe('binder/schema-summary', () => {
  it('summarizes the workbook and picks Superstore as primary', () => {
    const s = summarizeSchema(WORKBOOK_XML);
    expect(s.datasource).toBe('Superstore');
    expect(s.fields.find((f) => f.name === 'Sales')?.role).toBe('measure');
    expect(s.fields.find((f) => f.name === 'Region')?.role).toBe('dimension');
  });
});

describe('binder/classifyNoLlm', () => {
  it('picks ranking-ordered-bar for a clear bar ask and binds by kind', () => {
    const s = summarizeSchema(WORKBOOK_XML);
    const cls = classifyNoLlm('bar chart of Sales by Region', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('ranking-ordered-bar');
    expect(cls!.bindings).toEqual([
      { slot_id: 'region', field: 'Region' },
      { slot_id: 'sales', field: 'Sales' },
    ]);
  });

  it('returns null (fail-closed) when no keyword clearly wins', () => {
    const s = summarizeSchema(WORKBOOK_XML);
    expect(classifyNoLlm('hello there', manifests, s)).toBeNull();
  });

  // ── W2-CT sibling-stamp tie-break regressions ──────────────────────────────
  // ranking-ordered-column and part-to-whole-stacked-bar-chart are now BOTH
  // fast_path_eligible siblings of ranking-ordered-bar / part-to-whole-treemap
  // (wave3 floor-raise stamps, synced as data this lane). The distinctive chart-noun
  // keywords ('bar'/'column'/'stacked-bar') fall below the family-native majority;
  // without a deterministic chart-noun tie-break these clear one-shot asks would
  // fail-closed to propose. These run against bare `manifests` (native eligibility).
  it('picks ranking-ordered-column for a clear column ask (distinct-noun sibling)', () => {
    const s = summarizeSchema(WORKBOOK_XML);
    const cls = classifyNoLlm('column chart of Sales by Region', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('ranking-ordered-column');
    expect(cls!.bindings).toEqual([
      { slot_id: 'region', field: 'Region' },
      { slot_id: 'sales', field: 'Sales' },
    ]);
  });

  it("picks part-to-whole-stacked-bar-chart for a 'stacked bar' ask (specific noun beats generic 'bar')", () => {
    const s = summarizeSchema(WORKBOOK_XML);
    const cls = classifyNoLlm('stacked bar of Sales by Region and Category', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('part-to-whole-stacked-bar-chart');
    expect(cls!.bindings.map((b) => b.slot_id).sort()).toEqual(['category', 'region', 'sales']);
  });

  it('sibling eligibility does NOT flip a previously-bound bar ask (regression pin)', () => {
    const s = summarizeSchema(WORKBOOK_XML);
    const cls = classifyNoLlm('bar chart of Sales by Region', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('ranking-ordered-bar');
  });

  it('still fails closed on a genuinely ambiguous cross-family ask (no chart noun to break the tie)', () => {
    // 'top' (ranking) + 'share' (part-to-whole) tie across families; neither is a
    // chart noun → no deterministic winner → must stay null (fail-closed preserved).
    const s = summarizeSchema(WORKBOOK_XML);
    expect(classifyNoLlm('top share of Sales by Region', manifests, s)).toBeNull();
  });
});

// ── e4: string-month temporal slot (temporal_from_string) ─────────────────────
// trend-line-chart's order_date slot opts in via temporal_from_string:true. A 'YYYY-MM'
// STRING month must be an acceptable source for it (DATEPARSE'd downstream to a continuous
// axis) — WITHOUT this the string month never fills the temporal slot, the required-slot
// gate fails, and the singer thrashes into a bar-over-strings (e4: 310s, judge 40).
describe('binder/classifyNoLlm — temporal_from_string (e4 string month)', () => {
  const MAU_STRING_MONTH_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='MAU'>
      <column name='[month]' role='dimension' type='nominal' datatype='string' />
      <column name='[Mau]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;

  it('binds trend-line-chart with a STRING month on the temporal slot (order_date)', () => {
    const s = summarizeSchema(MAU_STRING_MONTH_XML);
    const cls = classifyNoLlm('line chart of Mau by month', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe('trend-line-chart');
    const bySlot = Object.fromEntries(cls!.bindings.map((b) => [b.slot_id, b.field]));
    // The string 'month' fills the temporal order_date slot (was fail-closed before the fix).
    expect(bySlot['order_date']).toBe('month');
    expect(bySlot['sales']).toBe('Mau');
  });

  it('does NOT fill a temporal_from_string slot with a NON-temporal-named string (region)', () => {
    const nonTemporalXml = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='S'>
      <column name='[region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Mau]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;
    const s = summarizeSchema(nonTemporalXml);
    // 'region' fails TEMPORAL_NAME_RE, so inferStringTemporal returns null → the temporal
    // slot stays unfilled → fail-closed (no wrong DATEPARSE on a non-date string).
    expect(classifyNoLlm('line chart of Mau by region', manifests, s)).toBeNull();
  });
});

// ── Blake wall #2: confident measure-free lat/long symbol map ─────────────────
// A plain "map of office locations" ask (pm_name, city, latitude, longitude — NO
// measure) must be able to bind CONFIDENTLY (used_llm=false) to spatial-symbol-map-
// latlon by COORDINATE-NAME AFFINITY: longitude→cols, latitude→rows (NEVER swapped),
// a categorical→detail, NO size/color measure. The template ships gated OFF
// (fast_path_eligible=false, render_verified='none') until the orchestrator live-
// render-stamps it, so these exercise the resolver via `withForcedEligible` — exactly
// the blessed pattern for a stamped-pending code path (same as the scatter/pie forcings
// above). The axis-swap regression is the #1 risk: the reversed-order case proves the
// coordinate→axis assignment is name-driven, not schema-order-driven.
describe('binder/classifyNoLlm — measure-free lat/long symbol map (Blake wall #2)', () => {
  // pm_name + city are dimensions; latitude + longitude are the coordinate measures.
  // NO other measure — a size/color measure would be needed by the old required slot.
  const LATLON_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Offices'>
      <column name='[pm_name]' role='dimension' type='nominal' datatype='string' />
      <column name='[city]' role='dimension' type='nominal' datatype='string' />
      <column name='[latitude]' role='measure' type='quantitative' datatype='real' />
      <column name='[longitude]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

  // SAME fields, coordinate columns in REVERSED order (longitude BEFORE latitude) — the
  // axis-swap regression lock: a schema-order binder would put longitude on rows here.
  const LATLON_REVERSED_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Offices'>
      <column name='[pm_name]' role='dimension' type='nominal' datatype='string' />
      <column name='[city]' role='dimension' type='nominal' datatype='string' />
      <column name='[longitude]' role='measure' type='quantitative' datatype='real' />
      <column name='[latitude]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

  // Coordinate/point-location INTENT is present, but the two measures are unlabeled
  // coordinate-ish fields — neither uniquely resolves to latitude or longitude. The
  // resolver must fail closed (null → propose), never a blind role-greedy bind.
  const AMBIGUOUS_COORD_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Sites'>
      <column name='[office]' role='dimension' type='nominal' datatype='string' />
      <column name='[X Coordinate]' role='measure' type='quantitative' datatype='real' />
      <column name='[Y Coordinate]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

  const LATLON = 'spatial-symbol-map-latlon';

  it('binds spatial-symbol-map-latlon by coordinate affinity: longitude→cols, latitude→rows, ALL dims→detail, NO measure', () => {
    const forced = withForcedEligible([LATLON]);
    const s = summarizeSchema(LATLON_WORKBOOK_XML);
    const cls = classifyNoLlm('Build me a Tableau map of the office locations', forced, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe(LATLON);

    const bySlot = Object.fromEntries(cls!.bindings.map((b) => [b.slot_id, b.field]));
    expect(bySlot['longitude']).toBe('longitude');
    expect(bySlot['latitude']).toBe('latitude');
    // GRAIN: EVERY non-coordinate dimension lands on a detail slot so no marks collapse to
    // an AVG-centroid — pm_name AND city, not city alone (26 offices stay 26 marks).
    const detailFields = cls!.bindings
      .filter((b) => b.slot_id.startsWith('detail'))
      .map((b) => b.field)
      .sort();
    expect(detailFields).toEqual(['city', 'pm_name']);
    // NO size/color measure is bound — the map is a static symbol map now.
    expect(cls!.bindings.some((b) => b.slot_id === 'size_color_measure')).toBe(false);
    // lon + lat + two detail dims = 4 bindings.
    expect(cls!.bindings).toHaveLength(4);

    // The axis roles are fixed by the manifest slot definitions: the longitude slot is
    // on cols and the latitude slot is on rows. Binding the longitude field to the
    // longitude slot therefore puts longitude on cols and latitude on rows.
    const m = forced.get(LATLON)!;
    expect(m.slots.find((sl) => sl.slot_id === 'longitude')!.role).toContain('cols');
    expect(m.slots.find((sl) => sl.slot_id === 'latitude')!.role).toContain('rows');
    // The removed measure slot must be gone from the manifest entirely.
    expect(m.slots.some((sl) => sl.slot_id === 'size_color_measure')).toBe(false);
  });

  it('AXIS-SWAP PROOF: reversed coordinate-column order still binds longitude→cols, latitude→rows', () => {
    const forced = withForcedEligible([LATLON]);
    const s = summarizeSchema(LATLON_REVERSED_WORKBOOK_XML);
    const cls = classifyNoLlm('Build me a Tableau map of the office locations', forced, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe(LATLON);

    const bySlot = Object.fromEntries(cls!.bindings.map((b) => [b.slot_id, b.field]));
    // Regardless of the schema field order, the coordinate NAMES drive the axes.
    expect(bySlot['longitude']).toBe('longitude');
    expect(bySlot['latitude']).toBe('latitude');
    const detailFields = cls!.bindings
      .filter((b) => b.slot_id.startsWith('detail'))
      .map((b) => b.field)
      .sort();
    expect(detailFields).toEqual(['city', 'pm_name']);
    expect(cls!.bindings.some((b) => b.slot_id === 'size_color_measure')).toBe(false);
  });

  it('fails closed (null → propose) on an ambiguous geo ask with two unlabeled coordinate-ish measures', () => {
    const forced = withForcedEligible([LATLON]);
    const s = summarizeSchema(AMBIGUOUS_COORD_WORKBOOK_XML);
    expect(classifyNoLlm('Build me a Tableau map of the office locations', forced, s)).toBeNull();
  });

  it('WIDE REAL SCHEMA: 3+ dims → binds coords + the single BEST detail dim (Blake World Cup), not fail-closed', () => {
    // Blake's real teams.csv is WIDE (team_id/team_api_id/group_name/country_code/team_name +
    // coords + flag/color/source) — 5 categoricals. The mark identity is ONE label (team_name),
    // not every attribute. pickBestDetailDim scores team_name up (+ 'team' overlaps the ask,
    // '+name'), and penalizes id/code/source, so it wins uniquely → confident single bind with
    // team_name on detail, coords on axes. (Before: 3+ → fail closed → thrash on real map data.)
    const wideXml = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Teams'>
      <column name='[team_id]' role='dimension' type='nominal' datatype='string' />
      <column name='[team_api_id]' role='dimension' type='nominal' datatype='string' />
      <column name='[group_name]' role='dimension' type='nominal' datatype='string' />
      <column name='[country_code]' role='dimension' type='nominal' datatype='string' />
      <column name='[team_name]' role='dimension' type='nominal' datatype='string' />
      <column name='[latitude]' role='measure' type='quantitative' datatype='real' />
      <column name='[longitude]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;
    const forced = withForcedEligible([LATLON]);
    const s = summarizeSchema(wideXml);
    const cls = classifyNoLlm('Build me a map of the World Cup team locations', forced, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe(LATLON);
    const bySlot = Object.fromEntries(cls!.bindings.map((b) => [b.slot_id, b.field]));
    expect(bySlot['longitude']).toBe('longitude');
    expect(bySlot['latitude']).toBe('latitude');
    const detailFields = cls!.bindings.filter((b) => b.slot_id.startsWith('detail')).map((b) => b.field);
    // exactly ONE detail dim, and it is the label (team_name) — not id/code/group noise.
    expect(detailFields).toEqual(['team_name']);
  });

  it('AMBIGUOUS wide schema (3+ dims, no clear best) still FAILS CLOSED — a wrong grain is worse than a propose', () => {
    // Three generic-noun dims none of which overlaps the ask or is a 'name' label → a genuine
    // scoring tie → pickBestDetailDim returns null → classification fails closed (propose).
    const tieXml = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Sites'>
      <column name='[alpha]' role='dimension' type='nominal' datatype='string' />
      <column name='[beta]' role='dimension' type='nominal' datatype='string' />
      <column name='[gamma]' role='dimension' type='nominal' datatype='string' />
      <column name='[latitude]' role='measure' type='quantitative' datatype='real' />
      <column name='[longitude]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;
    const forced = withForcedEligible([LATLON]);
    const s = summarizeSchema(tieXml);
    expect(classifyNoLlm('Build me a map of the site locations', forced, s)).toBeNull();
  });

  it('is LIVE in production: the committed manifest is render-stamped eligible and binds the office-map ask', () => {
    // Render-stamped 2026-07-22 (live sing of the office-location ask, N=3: 16.3s/8.5s/14.7s,
    // all confident single-BIND, judge 86). The committed manifest carries fast_path_eligible
    // true + render_verified live-2026-07-22, so the resolver fires against the UN-forced
    // manifest set — no test-only forcing needed anymore.
    expect(manifests.get(LATLON)!.fast_path_eligible).toBe(true);
    expect(manifests.get(LATLON)!.portability_evidence.render_verified).toBe('live-2026-07-22');
    const s = summarizeSchema(LATLON_WORKBOOK_XML);
    const cls = classifyNoLlm('Build me a Tableau map of the office locations', manifests, s);
    expect(cls).not.toBeNull();
    expect(cls!.template).toBe(LATLON);
    const detailFields = cls!.bindings
      .filter((b) => b.slot_id.startsWith('detail'))
      .map((b) => b.field)
      .sort();
    expect(detailFields).toEqual(['city', 'pm_name']);
  });

  it('does NOT hijack a plain geocoded map ask (no coordinate/point-location intent → generic path)', () => {
    // "choropleth of Sales by Region" has no coordinate keyword and no point-location
    // cue, so even with latlon forced eligible the resolver must not fire; the generic
    // spatial path handles it (and here fails closed on non-geo Superstore-shaped dims,
    // proving the resolver did not step in).
    const forced = withForcedEligible([LATLON]);
    const s = summarizeSchema(LATLON_WORKBOOK_XML);
    // A non-coordinate map ask over a lat/lon schema must not bind latlon.
    const cls = classifyNoLlm('choropleth of Sales by Region', forced, s);
    expect(cls?.template).not.toBe(LATLON);
  });
});

describe('binder/classifyNoLlm — binds calc-forced optional inputs (H3)', () => {
  // A single eligible template whose REQUIRED calc depends on an OPTIONAL slot m2.
  // The no-LLM role-greedy binder must still fill m2 (a required calc forces it),
  // otherwise the calc would dangle and the fast path would needlessly escalate.
  const forced: TemplateManifest = {
    template: 'x-calc-force',
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: ['calcforce'],
    description: 'test template forcing an optional calc input',
    slots: [
      {
        slot_id: 'm1',
        template_field: 'M1',
        derivation: 'sum',
        role: ['cols'],
        kind: 'quantitative',
        bindable: true,
        required: true,
      },
      {
        slot_id: 'm2',
        template_field: 'M2',
        derivation: 'sum',
        role: ['rows'],
        kind: 'quantitative',
        bindable: true,
        required: false,
      },
    ],
    calcs: [
      {
        slot_id: 'ratio',
        template_field: 'Calculation_1',
        derivation: 'usr',
        role: ['color'],
        kind: 'calc',
        bindable: false,
        required: true,
        formula: 'SUM([M1])/SUM([M2])',
        formula_refs: ['M1', 'M2'],
        depends_on_slots: ['m1', 'm2'],
        result_role: 'measure',
        inputs: [
          {
            ref: 'M1',
            slot_id: 'm1',
            slot_kind: 'quantitative',
            required: true,
            template_internal: false,
          },
          {
            ref: 'M2',
            slot_id: 'm2',
            slot_kind: 'quantitative',
            required: true,
            template_internal: false,
          },
        ],
      },
    ],
    hazards: [],
  };

  it('role-greedy binds the optional slot a required calc forces', () => {
    const s = summarizeSchema(WORKBOOK_XML);
    const cls = classifyNoLlm(
      'calcforce of Sales and Profit',
      new Map([['x-calc-force', forced]]),
      s,
    );
    expect(cls).not.toBeNull();
    const slotIds = cls!.bindings.map((b) => b.slot_id).sort();
    expect(slotIds).toEqual(['m1', 'm2']);
  });
});

describe('binder/bindTemplate — Call 1 no-LLM (bound)', () => {
  it("'bar chart of Sales by Region' → ranking-ordered-bar, exact field_mapping, used_llm=false", async () => {
    const res = await bindTemplate({
      ask: 'bar chart of Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('ranking-ordered-bar');
      expect(res.args.sheet_type).toBe('worksheet');
      expect(res.args.template_parameters.DATASOURCE).toBe('Superstore');
      expect(res.args.field_mapping).toEqual({
        Region: '[Superstore].[none:Region:nk]',
        Sales: '[Superstore].[sum:Sales:qk]',
      });
      // IMPORTANT NEW FACT: bound result exposes the worksheet-path apply hint so a
      // caller can run the worksheet-level chain (tabdoc:new-worksheet → substitute →
      // apply-worksheet) OR the inject-template + apply-workbook chain from one result.
      expect(res.apply_hint).toBe('worksheet-path');
      expect(res.apply_instruction).toMatch(/tabdoc:new-worksheet/);
      expect(res.apply_instruction).toMatch(/apply-worksheet/);
    }
  });
});

describe('binder/bindTemplate — Call 1 miss (propose)', () => {
  // scatter is render-unverified post-gate; force it eligible to test the propose
  // payload shape (calc-excluded bindable slots) independent of the shrink.
  const scatterManifests = (): Map<string, TemplateManifest> =>
    withForcedEligible(['correlation-scatter-plot-chart']);

  it('under-specified scatter ask → propose payload with only bindable slots + fields + schema', async () => {
    const res = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: scatterManifests(),
    });
    expect(res.status).toBe('propose');
    if (res.status === 'propose') {
      const scatter = res.llm_input.candidate_templates.find(
        (c) => c.template === 'correlation-scatter-plot-chart',
      );
      expect(scatter).toBeDefined();
      // Only the 4 BINDABLE slots — the template-owned calc is excluded.
      expect(scatter!.slots.length).toBe(4);
      expect(scatter!.slots.every((sl) => (sl.kind as string) !== 'calc')).toBe(true);
      // Fields carried for the model to choose from.
      expect(res.llm_input.fields.some((f) => f.name === 'Profit')).toBe(true);
      expect(res.llm_input.fields.some((f) => f.name === 'Region')).toBe(true);
      // Strict output schema is echoed.
      expect(res.output_schema).toBe(PROPOSAL_OUTPUT_SCHEMA);
      expect((res.output_schema as { type?: string }).type).toBe('object');
    }
  });

  it('every propose candidate exposes only bindable slots', async () => {
    const forced = scatterManifests();
    const res = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: forced,
    });
    if (res.status === 'propose') {
      for (const c of res.llm_input.candidate_templates) {
        const m = forced.get(c.template)!;
        const bindableCount = m.slots.filter((sl) => sl.bindable).length;
        expect(c.slots.length).toBe(bindableCount);
      }
    } else {
      throw new Error(`expected propose, got ${res.status}`);
    }
  });
});

describe('binder/bindTemplate — Call 2 (agent proposal)', () => {
  it('valid scatter proposal → bound with used_llm=true and 4-slot mapping', async () => {
    const proposal: BindingProposal = {
      template: 'correlation-scatter-plot-chart',
      title: 'Profit vs Sales',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: withForcedEligible(['correlation-scatter-plot-chart']),
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(true);
      expect(res.args.field_mapping).toEqual({
        Sales: '[Superstore].[sum:Sales:qk]',
        Profit: '[Superstore].[sum:Profit:qk]',
        'Customer Name': '[Superstore].[none:Customer Name:nk]',
        Region: '[Superstore].[none:Region:nk]',
      });
    }
  });

  it("bound InjectTemplateArgs.field_mapping covers the calc's inputs so the engine rewrite resolves them", async () => {
    const proposal: BindingProposal = {
      template: 'correlation-scatter-plot-chart',
      title: 'Profit vs Sales',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: withForcedEligible(['correlation-scatter-plot-chart']),
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      const m = manifests.get('correlation-scatter-plot-chart')!;
      const keys = new Set(Object.keys(res.args.field_mapping));
      for (const input of m.calcs[0].inputs ?? []) {
        if (input.template_internal) continue;
        expect(keys.has(input.ref), `field_mapping key for calc input [${input.ref}]`).toBe(true);
      }
    }
  });

  it('unknown template → escalate template-not-found', async () => {
    const proposal: BindingProposal = { template: 'does-not-exist', title: 't', bindings: [] };
    const res = await bindTemplate({ ask: 'x', workbookXml: WORKBOOK_XML, manifests, proposal });
    expect(res.status).toBe('escalate');
    if (res.status === 'escalate') expect(res.reason).toBe('template-not-found');
  });

  it('below-floor confidence → escalate low-confidence', async () => {
    const proposal: BindingProposal = {
      template: 'ranking-ordered-bar',
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      confidence: 0.1,
    };
    const res = await bindTemplate({
      ask: 'bar of sales by region',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
      minConfidence: 0.6,
    });
    expect(res.status).toBe('escalate');
    if (res.status === 'escalate') expect(res.reason).toBe('low-confidence');
  });

  it('threads sort and top_n from a valid proposal into bound args', async () => {
    const proposal: BindingProposal = {
      template: 'ranking-ordered-bar',
      title: 'Top Sales by Region',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      sort: { by: 'Sales', direction: 'desc' },
      top_n: 10,
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'top 10 regions by sales',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.sort).toEqual({ by: 'Sales', direction: 'desc' });
      expect(res.args.top_n).toBe(10);
    }
  });

  it('bad sort.by binds fail-open with a warning and no sort arg', async () => {
    const proposal: BindingProposal = {
      template: 'ranking-ordered-bar',
      title: 'Top Sales by Region',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      sort: { by: 'Definitely Not A Field', direction: 'desc' },
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'regions by sales',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.sort).toBeUndefined();
      expect(res.warnings?.join(' ')).toContain('Definitely Not A Field');
      expect(res.warnings?.join(' ')).toContain("template's default sort");
    }
  });

  it('waterfall proposal accepts optional anchor_category as a field_mapping entry', async () => {
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'sub_category', field: 'Sub-Category' },
        { slot_id: 'anchor_category', field: 'Category' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'P&L waterfall with subtotal and total rows tagged by Category',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.field_mapping['Anchor Category']).toBe('[Superstore].[none:Category:nk]');
    }
  });

  it('unresolvable field → escalate field-not-found (carries candidates)', async () => {
    const proposal: BindingProposal = {
      template: 'ranking-ordered-bar',
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Nope Field' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const res = await bindTemplate({
      ask: 'bar of sales by region',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('escalate');
    if (res.status === 'escalate') {
      expect(res.reason).toBe('field-not-found');
      expect(res.proposal).toBeDefined();
    }
  });

  // A P&L workbook whose intended bridge order lives in a non-displayed sequence column.
  const PL_ORDER_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='PL'>
      <column name='[line_item]' role='dimension' type='nominal' datatype='string' />
      <column name='[amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[category]' role='dimension' type='nominal' datatype='string' />
      <column name='[display_order]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;

  it('waterfall DEFAULTS the step order to a sequence column when no sort is proposed', async () => {
    // m1 fix: the running total is order-dependent; without this the confident bind keeps the
    // template DESC-by-measure default and the singer's later sort attempt lands only ~1/3 of runs.
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'amount' },
        { slot_id: 'sub_category', field: 'line_item' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'P&L waterfall from revenue to net income',
      workbookXml: PL_ORDER_WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.sort).toEqual({ by: 'display_order', direction: 'asc' });
    }
  });

  it('waterfall does NOT default a sort when the schema has no sequence column', async () => {
    // WORKBOOK_XML has no order column (Order Date does not count) — keep the template default.
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'sub_category', field: 'Sub-Category' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'P&L waterfall',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.sort).toBeUndefined();
    }
  });

  it('an explicit proposal.sort overrides the waterfall order default', async () => {
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'amount' },
        { slot_id: 'sub_category', field: 'line_item' },
      ],
      sort: { by: 'amount', direction: 'desc' },
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'P&L waterfall sorted by amount',
      workbookXml: PL_ORDER_WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.sort).toEqual({ by: 'amount', direction: 'desc' });
    }
  });

  it('waterfall DEFAULTS anchor_category to a row-type column when none is bound', async () => {
    // m1 fix: subtotal/total rows double-count the running total unless anchor_category
    // excludes them; the singer lands the anchor only ~half the runs. A bare confident bind
    // must exclude them deterministically. PL_ORDER has a `category` dimension.
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'amount' },
        { slot_id: 'sub_category', field: 'line_item' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'P&L waterfall revenue to net income',
      workbookXml: PL_ORDER_WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      // Anchor Category auto-bound to the category dim → spliceWaterfallAnchorFilter fires.
      expect(res.args.field_mapping['Anchor Category']).toContain('category');
      // Warning describes what was ADDED (an exclusion of subtotal/total members), not an
      // assertion that rows were excluded — the splice is inert when no such members exist.
      const warn = res.warnings?.join(' ') ?? '';
      expect(warn).toContain('auto-bound anchor_category');
      expect(warn).toMatch(/subtotal.*total/);
    }
  });

  it('does NOT default anchor_category when no row-type column exists', async () => {
    // A waterfall schema with only the axis + measure + a sequence col — no category/type
    // dimension — must NOT invent an anchor (nothing to exclude).
    const noCatXml = PL_ORDER_WORKBOOK_XML.replace(/\n\s*<column name='\[category\]'[^>]*\/>/, '');
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'amount' },
        { slot_id: 'sub_category', field: 'line_item' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'P&L waterfall',
      workbookXml: noCatXml,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect('Anchor Category' in res.args.field_mapping).toBe(false);
    }
  });
});

// Betting-shaped workbook whose measure name ('O/U Line') contains the token
// 'line' — a trap for the trend-line-chart intent keyword. The no-LLM path must
// pick kpi-text on 'kpi' regardless of the field name.
const KPI_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Bets'>
      <column name='[Team]' role='dimension' type='nominal' datatype='string' />
      <column name='[O/U Line]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

describe('binder/bindTemplate — derivation override (no-LLM)', () => {
  it("'average O/U Line as a KPI' binds kpi-text with an avg override via the no-LLM path", async () => {
    const res = await bindTemplate({
      ask: 'average O/U Line as a KPI',
      workbookXml: KPI_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('kpi-text');
      // Manifest default is sum; the ask said 'average', so the emitted value is avg.
      expect(res.args.field_mapping['Value']).toBe('[Bets].[avg:O/U Line:qk]');
    }
  });

  it('no aggregation word in the ask → no override (template default sum is kept)', async () => {
    const res = await bindTemplate({
      ask: 'O/U Line as a KPI',
      workbookXml: KPI_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.field_mapping['Value']).toBe('[Bets].[sum:O/U Line:qk]');
    }
  });
});

describe('binder/PROPOSAL_OUTPUT_SCHEMA — optional derivation field', () => {
  it("the strict output schema's binding items expose an optional derivation enum", () => {
    const schema = PROPOSAL_OUTPUT_SCHEMA as {
      properties: {
        bindings: {
          items: {
            properties: Record<string, { type?: string; enum?: string[] }>;
            required: string[];
          };
        };
      };
    };
    const itemProps = schema.properties.bindings.items.properties;
    expect(itemProps.derivation).toBeDefined();
    expect(Array.isArray(itemProps.derivation.enum)).toBe(true);
    expect(itemProps.derivation.enum).toContain('avg');
    // derivation is optional: not in the required list.
    expect(schema.properties.bindings.items.required).not.toContain('derivation');
  });

  it('advertises optional sort and top_n proposal fields', () => {
    const schema = PROPOSAL_OUTPUT_SCHEMA as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties.sort).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['by', 'direction'],
      properties: {
        by: { type: 'string', description: 'Sort field.' },
        direction: { type: 'string', enum: ['asc', 'desc'], description: 'Sort dir.' },
      },
    });
    expect(schema.properties.top_n).toEqual({
      type: 'integer',
      minimum: 1,
      description: 'Top N.',
    });
    expect(schema.required).not.toContain('sort');
    expect(schema.required).not.toContain('top_n');
  });
});

describe('binder/bindTemplate — avoid_when consumption (H3.2)', () => {
  // NB: the asks below use "per" (not "by") to join the measure/dimension. avoid_when
  // lives only on pie + dual-axis, which are render-unverified post-gate; force pie
  // eligible so the demote/warnings behavior is testable independent of the shrink.
  const pieManifests = (): Map<string, TemplateManifest> =>
    withForcedEligible(['part-to-whole-pie-chart']);

  // (b) DEMOTE: a pie ask whose terms hit the template's avoid_when guidance
  // must fall through to the propose leg so the model weighs the caution.
  it("pie ask with 'precise comparison' terms demotes the no-LLM shortcut → propose", async () => {
    const res = await bindTemplate({
      ask: 'pie chart of Sales per Region for precise comparison',
      workbookXml: WORKBOOK_XML,
      manifests: pieManifests(),
    });
    expect(res.status).toBe('propose');
    if (res.status === 'propose') {
      // (a) the propose payload carries the pie's avoid_when so the model sees it.
      const pie = res.llm_input.candidate_templates.find(
        (c) => c.template === 'part-to-whole-pie-chart',
      );
      expect(pie).toBeDefined();
      expect(pie!.avoid_when && pie!.avoid_when.length > 0).toBe(true);
    }
  });

  // A clean pie ask (no caution terms) still binds via the zero-latency no-LLM
  // path with no warnings. NB: this control forces pie the SOLE part-to-whole
  // fast-path template (treemap made ineligible). With BOTH treemap and pie
  // eligible, the stage-2b sole-wrong-matcher guard would conservatively demote
  // "pie" (a keyword carried by only one of two same-family fast-path templates
  // → not family-native by strict majority) to propose — safe, never wrong, but
  // it would confound this "clean ask binds" vs "caution ask demotes" contrast.
  // Isolating pie as the lone part-to-whole template (its keywords are then all
  // family-native) tests exactly the intended clean-bind behavior. See
  // within-family-disambiguation.test.ts for the guard's demotion coverage.
  const pieOnlyManifests = (): Map<string, TemplateManifest> => {
    const out = pieManifests();
    const treemap = out.get('part-to-whole-treemap-chart');
    if (treemap) out.set('part-to-whole-treemap-chart', { ...treemap, fast_path_eligible: false });
    return out;
  };
  it('clean pie ask still binds no-LLM with no warnings', async () => {
    const res = await bindTemplate({
      ask: 'pie chart of Sales per Region',
      workbookXml: WORKBOOK_XML,
      manifests: pieOnlyManifests(),
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('part-to-whole-pie-chart');
      expect(res.warnings).toBeUndefined();
    }
  });

  // (c) WARNINGS: if the model (Call 2) still proposes the pie for a caution-
  // matching ask, the matched avoid_when strings ride along as advisory warnings
  // on the bound result — never blocking.
  it('Call 2 pie proposal for a caution-matching ask → bound with warnings', async () => {
    const proposal: BindingProposal = {
      template: 'part-to-whole-pie-chart',
      title: 'Share',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'pie chart of Sales per Region for precise comparison',
      workbookXml: WORKBOOK_XML,
      manifests: pieManifests(),
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.warnings && res.warnings.length > 0).toBe(true);
      expect(res.warnings!.some((w) => /precise/i.test(w))).toBe(true);
    }
  });
});

describe('binder/bindTemplate — W60 choropleth geo-slot completion', () => {
  it("'choropleth of Profit by State/Province' one-shot binds; country auto-completes to Country/Region", async () => {
    const res = await bindTemplate({
      ask: 'choropleth of Profit by State/Province',
      workbookXml: WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('spatial-choropleth-map');
      // The required country slot was NOT named in the ask; it auto-completes to the
      // unique country-affine field [Country/Region] (template_field 'Country'), while
      // the ask-named [State/Province] fills the state slot (template_field 'State').
      expect(res.args.field_mapping['Country']).toBe('[Superstore].[none:Country/Region:nk]');
      expect(res.args.field_mapping['State']).toBe('[Superstore].[none:State/Province:nk]');
      expect(res.args.optional_field_prunes).toBeUndefined();
      // Provenance is surfaced so the agent can say "using Country/Region".
      expect(res.warnings?.some((w) => /Country\/Region/.test(w))).toBe(true);
    }
  });
});

describe('binder/bindTemplate — country-only spatial maps', () => {
  it('binds a country-only choropleth and marks state for XML pruning', async () => {
    const res = await bindTemplate({
      ask: 'choropleth of Goals For by Country',
      workbookXml: COUNTRY_ONLY_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('spatial-choropleth-map');
      expect(res.args.field_mapping).toEqual({
        Country: '[Football].[none:Country:nk]',
        Profit: '[Football].[sum:Goals For:qk]',
      });
      expect(res.args.optional_field_prunes).toEqual([
        { templateField: 'State', derivation: 'none', role: 'nk' },
      ]);
    }
  });

  it('binds a country-only symbol map and marks state/city for XML pruning', async () => {
    const res = await bindTemplate({
      ask: 'symbol map of Goals For by Country',
      workbookXml: COUNTRY_ONLY_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('spatial-symbol-map');
      expect(res.args.field_mapping).toEqual({
        'Country/Region': '[Football].[none:Country:nk]',
        Sales: '[Football].[sum:Goals For:qk]',
      });
      expect(res.args.optional_field_prunes).toEqual([
        { templateField: 'State/Province', derivation: 'none', role: 'nk' },
        { templateField: 'City', derivation: 'none', role: 'nk' },
      ]);
    }
  });

  it('binds through near-duplicate country-only fields and surfaces cleanup notes', async () => {
    const res = await bindTemplate({
      ask: 'choropleth of Goals For by Country',
      workbookXml: COUNTRY_ONLY_DUPLICATE_WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.field_mapping).toEqual({
        Country: '[Football].[none:Country:nk]',
        Profit: '[Football].[sum:Goals For:qk]',
      });
      expect(res.warnings).toEqual(
        expect.arrayContaining([
          'dataset has near-duplicate columns Country/Country1 - used Country; consider cleaning the source',
          'dataset has near-duplicate columns Goals For/Goals For1 - used Goals For; consider cleaning the source',
        ]),
      );
    }
  });
});

describe('binder/buildLlmInput — family-aware truncation (attack 2)', () => {
  function synth(template: string, family: Family, keyword: string): TemplateManifest {
    return {
      template,
      family,
      readiness: 'GREEN',
      fast_path_eligible: true,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
      datasource_placeholder: true,
      placeholders: ['TITLE', 'DATASOURCE'],
      intent_keywords: [keyword],
      description: `${family} chart`,
      slots: [
        {
          slot_id: 'value',
          template_field: 'Value',
          derivation: 'sum',
          role: ['text'],
          kind: 'quantitative',
          bindable: true,
          required: true,
        },
      ],
      calcs: [],
      hazards: [],
    };
  }

  it('caps at K but never silently drops a whole matching family (>K families ⇒ propose leg)', () => {
    // 6 eligible templates across 6 distinct families, all matching the ask.
    const fams: Family[] = [
      'time-series',
      'ranking',
      'part-to-whole',
      'correlation',
      'distribution',
      'deviation',
    ];
    const m = new Map<string, TemplateManifest>();
    fams.forEach((f, i) => m.set(`t${i}`, synth(`t${i}`, f, `kw${i}`)));
    const ask = fams.map((_, i) => `kw${i}`).join(' '); // every keyword scores
    const summary = summarizeSchema(WORKBOOK_XML);

    const input = buildLlmInput(ask, m, summary);
    const familiesShown = new Set(input.candidate_templates.map((c) => m.get(c.template)!.family));
    // A naive slice(0,5) would drop one whole family (5 of 6). Family-aware keeps all 6.
    expect(familiesShown.size).toBe(6);
  });

  it('within K, still fills headroom with the next-best candidates', () => {
    // 3 families, 5 templates: family 'correlation' has 3 members. K=5 so all 5 fit.
    const m = new Map<string, TemplateManifest>();
    m.set('a', synth('a', 'ranking', 'kwa'));
    m.set('b', synth('b', 'time-series', 'kwb'));
    m.set('c1', synth('c1', 'correlation', 'kwc1'));
    m.set('c2', synth('c2', 'correlation', 'kwc2'));
    m.set('c3', synth('c3', 'correlation', 'kwc3'));
    const ask = 'kwa kwb kwc1 kwc2 kwc3';
    const input = buildLlmInput(ask, m, summarizeSchema(WORKBOOK_XML));
    expect(input.candidate_templates.length).toBe(5);
  });
});

describe('binder/bindTemplate — evidence gate escalation (attacks 5+10)', () => {
  it('a render-unverified template escalates not-fast-path', async () => {
    // pareto-chart binds the fixture (Sub-Category + Sales) but is render_verified:'none'
    // ⇒ fast_path_eligible:false ⇒ the binder must refuse it (honest shrink).
    // W60 used correlation-scatter-plot-chart, then connected-scatterplot, as the gate
    // target; W63's live-2026-07-13 stamp made connected-scatterplot legitimately eligible,
    // so this swaps to pareto-chart — still genuinely render-unverified — to keep the
    // not-fast-path escalation exercised.
    const proposal: BindingProposal = {
      template: 'pareto-chart',
      title: 'Pareto',
      bindings: [
        { slot_id: 'sub_category', field: 'Sub-Category' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'pareto chart of Sales by Sub-Category',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('escalate');
    if (res.status === 'escalate') expect(res.reason).toBe('not-fast-path');
  });
});

describe('binder/bindTemplate — hostile title XML escaping (M10 Finding 1)', () => {
  it('escapes a hostile proposal title in the bound args (verbatim-substitution seam)', async () => {
    const proposal: BindingProposal = {
      template: 'ranking-ordered-bar',
      title: "x'/><datasource name='pwn2",
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'bar of sales by region',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.title).toBe('x&apos;/&gt;&lt;datasource name=&apos;pwn2');
      expect(res.args.title).not.toContain('<');
      expect(res.args.title).not.toContain("'");
    }
  });

  it('a clean title passes through byte-identical (fidelity)', async () => {
    const proposal: BindingProposal = {
      template: 'ranking-ordered-bar',
      title: 'Sales by Region',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
      confidence: 0.9,
    };
    const res = await bindTemplate({
      ask: 'bar of sales by region',
      workbookXml: WORKBOOK_XML,
      manifests,
      proposal,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') expect(res.args.title).toBe('Sales by Region');
  });

  it('makeTitle (Call-1) strips control chars from the generated title (library mirror, Finding 2)', async () => {
    const res = await bindTemplate({
      ask: 'bar chart of Sales by Region\u0000\u001B',
      workbookXml: WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.args.title).toBe('bar chart of Sales by Region');
      expect(TITLE_CONTROL_CHAR_RE.test(res.args.title)).toBe(false);
    }
  });
});

describe('binder — schema-too-large fail-closed cap (M10 Finding 3)', () => {
  function wideWorkbookXml(n: number): string {
    let cols = '';
    for (let i = 0; i < n; i++) {
      cols += `<column name='[F${i}]' role='measure' type='quantitative' datatype='real' />`;
    }
    return `<?xml version='1.0' encoding='utf-8'?><workbook><datasources><datasource name='Big'>${cols}</datasource></datasources></workbook>`;
  }

  function synthSummary(n: number): SchemaSummary {
    const fields = [];
    for (let i = 0; i < n; i++) {
      fields.push({
        name: `F${i}`,
        columnName: `[F${i}]`,
        role: 'measure' as const,
        type: 'quantitative',
        datatype: 'real',
        datasource: 'Big',
        isAggregated: false,
        column_ref: `[Big].[sum:F${i}:qk]`,
      });
    }
    return { datasource: 'Big', fields };
  }

  it('bindTemplate escalates schema-too-large above the cap (named reason, no truncated classify)', async () => {
    const n = MAX_CLASSIFIABLE_FIELDS + 1;
    const res = await bindTemplate({
      ask: 'bar chart of F0 by F1',
      workbookXml: wideWorkbookXml(n),
      manifests,
    });
    expect(res.status).toBe('escalate');
    if (res.status === 'escalate') {
      expect(res.reason).toBe('schema-too-large');
      expect(res.blockers[0].code).toBe('schema-too-large');
      expect(res.blockers[0].detail).toBe(
        `schema-too-large: ${n} fields > ${MAX_CLASSIFIABLE_FIELDS} cap`,
      );
    }
  });

  it('bindTemplate does NOT escalate schema-too-large at the cap boundary (5000)', async () => {
    const res = await bindTemplate({
      ask: 'bar chart of Sales by Region',
      workbookXml: wideWorkbookXml(MAX_CLASSIFIABLE_FIELDS),
      manifests,
    });
    // At the boundary the classifier runs normally; the ask names no schema field so it
    // falls through to propose — the key point is it is NOT the schema-too-large escalate.
    expect(res.status !== 'escalate' || res.reason !== 'schema-too-large').toBe(true);
  });

  it('classifyNoLlm fails closed (returns null, no truncated subset) above the cap', () => {
    // Short-circuits at the TOP before the per-field hot loop — synthetic summary keeps
    // this cheap and proves the fail-closed disposition independent of XML parsing.
    expect(
      classifyNoLlm('bar chart of F0 by F1', manifests, synthSummary(MAX_CLASSIFIABLE_FIELDS + 1)),
    ).toBeNull();
  });

  it('classifyNoLlm still runs at the cap boundary (5000 does not short-circuit)', () => {
    // 5000 is <= cap, so it proceeds through the normal path (returns null here only
    // because the generic F-measure schema names nothing the ask matches) — proving the
    // boundary is inclusive.
    expect(
      classifyNoLlm('bar chart of F0 by F1', manifests, synthSummary(MAX_CLASSIFIABLE_FIELDS)),
    ).toBeNull();
  });
});

describe('binder/bindTemplate — eval-only injected llmPropose', () => {
  it('Call 1 miss + injected llmPropose closes the loop in-process (used_llm=true)', async () => {
    const res = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: withForcedEligible(['correlation-scatter-plot-chart']),
      llmPropose: (input) => {
        expect(input.candidate_templates.length).toBeGreaterThan(0);
        return Promise.resolve({
          template: 'correlation-scatter-plot-chart',
          title: 'Profit vs Sales',
          bindings: [
            { slot_id: 'sales', field: 'Sales' },
            { slot_id: 'profit', field: 'Profit' },
            { slot_id: 'customer_name', field: 'Customer Name' },
            { slot_id: 'region', field: 'Region' },
          ],
          confidence: 0.95,
        });
      },
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') expect(res.used_llm).toBe(true);
  });
});

describe('binder — deterministic-path hazard demotion (W59)', () => {
  it('a compound-string-parse template NEVER one-shot binds — the Superstore arrow ask demotes to propose', async () => {
    // Live-caught landmine: ww-ou-arrow (fast-path stamped on Super Bowl data) bound
    // 'over-under arrow chart of Sales by Sub-Category' and mapped [Category] into
    // sports-score SPLIT parsing → NULL calcs → broken viz. The hazard lives in the
    // DATA shape, which no natural ask reveals, so avoid_when can't catch it — the
    // no-LLM path must always fall through to propose for this hazard class.
    const res = await bindTemplate({
      ask: 'over-under arrow chart of Sales by Sub-Category',
      workbookXml: WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('propose');
    if (res.status === 'propose') {
      // Demote-only: the template must still be REACHABLE via the propose leg.
      const candidates = res.llm_input.candidate_templates.map((c) => c.template);
      expect(candidates).toContain('ww-ou-arrow');
    }
  });

  it('hazard-free stamped templates keep the one-shot path (control)', async () => {
    const res = await bindTemplate({
      ask: 'waterfall of Profit by Sub-Category',
      workbookXml: WORKBOOK_XML,
      manifests,
    });
    expect(res.status).toBe('bound');
    if (res.status === 'bound') {
      expect(res.used_llm).toBe(false);
      expect(res.args.template_name).toBe('part-to-whole-waterfall');
    }
  });
});
