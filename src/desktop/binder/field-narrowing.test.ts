// src/binder/field-narrowing.test.ts
//
// STAGE 2B FIELD-NARROWING (adjudicated attack 1, SUSTAINED): buildLlmInput used
// to send ALL summary.fields, so a wide schema (300–1000 fields) blew the propose
// prompt. These tests pin the narrowing contract:
//   - rank-1: fields whose name/caption tokens overlap the ask survive (even past N)
//   - rank-2: fields kind-compatible with a candidate's required slots come next
//   - cap at top-N (default 20, opt param) with an accurate more_available flag
//   - determinism: stable sort, name tiebreak
//   - PROMPT BUDGET: serialized LlmProposeInput stays under ~8k chars at 300 & 1000.

import { describe, expect, it } from 'vitest';

import { buildLlmInput } from './classify.js';
import type { Family, SlotKind, TemplateManifest } from './manifest-types.js';
import type { SchemaField, SchemaSummary } from './schema-summary.js';

// ── Budget justification ─────────────────────────────────────────────
// The small "propose" LLM prompt = system framing + output schema + this
// LlmProposeInput. ~8000 chars ≈ ~2000 tokens (≈4 chars/token), a comfortable
// slice that leaves ample headroom for the framing/schema in any small-context
// model. The cap (default 20 fields) is what makes the input WIDTH-INVARIANT:
// 20 fields at ≤ ~90 chars each ≈ 1.8k, plus ≤5 small candidate templates ≈ 2k,
// plus the ask + more_available note — well under budget at 300 AND 1000 fields.
const CHAR_BUDGET = 8000;

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
    isAggregated: false,
    column_ref: `[DS].[${name}]`,
  };
}

function synthManifest(
  template: string,
  family: Family,
  keyword: string,
  slots: Array<{ slot_id: string; kind: SlotKind }>,
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
    intent_keywords: [keyword],
    description: `${family} chart`,
    slots: slots.map((s) => ({
      slot_id: s.slot_id,
      template_field: s.slot_id,
      derivation: s.kind === 'quantitative' ? 'sum' : 'none',
      role: ['rows'],
      kind: s.kind,
      bindable: true,
      required: true,
    })),
    calcs: [],
    hazards: [],
  };
}

/** A single ranking-family template requiring one categorical + one quantitative slot. */
function barTemplate(): Map<string, TemplateManifest> {
  return new Map([
    [
      'ranking-ordered-bar',
      synthManifest('ranking-ordered-bar', 'ranking', 'bar', [
        { slot_id: 'cat', kind: 'categorical' },
        { slot_id: 'val', kind: 'quantitative' },
      ]),
    ],
  ]);
}

/** A template requiring ONLY a quantitative slot (to isolate rank-2 kind compat). */
function quantOnlyTemplate(): Map<string, TemplateManifest> {
  return new Map([
    [
      'magnitude-single-measure',
      synthManifest('magnitude-single-measure', 'magnitude', 'kpi', [
        { slot_id: 'val', kind: 'quantitative' },
      ]),
    ],
  ]);
}

/** Build a summary of `total` fields; the given `named` fields are appended LAST. */
function wideSummary(total: number, named: SchemaField[]): SchemaSummary {
  const fields: SchemaField[] = [];
  const fillerCount = total - named.length;
  for (let i = 0; i < fillerCount; i++) {
    const isMeas = i % 3 === 0;
    fields.push(
      isMeas
        ? field(`Filler Meas ${i}`, 'measure', 'quantitative', 'real')
        : field(`Filler Dim ${i}`, 'dimension', 'nominal', 'string'),
    );
  }
  fields.push(...named);
  return { datasource: 'DS', fields };
}

describe('binder/buildLlmInput — field narrowing (stage 2B)', () => {
  const askedFields = [
    field('Sales', 'measure', 'quantitative', 'real'),
    field('Region', 'dimension', 'nominal', 'string'),
    field('Order Date', 'dimension', 'ordinal', 'date'),
  ];
  const ask = 'bar chart of Sales by Region over Order Date';

  it('PROMPT BUDGET: stays under budget and keeps asked fields at 300 fields', () => {
    const summary = wideSummary(300, askedFields);
    const input = buildLlmInput(ask, barTemplate(), summary);

    expect(input.fields.length).toBe(20);
    const serialized = JSON.stringify(input);
    expect(serialized.length).toBeLessThan(CHAR_BUDGET);

    const names = new Set(input.fields.map((f) => f.name));
    for (const f of askedFields) expect(names.has(f.name)).toBe(true);

    expect(input.more_available?.count).toBe(280);
  });

  it('PROMPT BUDGET: stays under budget and keeps asked fields at 1000 fields', () => {
    const summary = wideSummary(1000, askedFields);
    const input = buildLlmInput(ask, barTemplate(), summary);

    expect(input.fields.length).toBe(20);
    const serialized = JSON.stringify(input);
    expect(serialized.length).toBeLessThan(CHAR_BUDGET);

    const names = new Set(input.fields.map((f) => f.name));
    for (const f of askedFields) expect(names.has(f.name)).toBe(true);

    expect(input.more_available?.count).toBe(980);
  });

  it('rank-1: an asked-for field beyond the cap still surfaces', () => {
    // One named field sits at index 300 (far past the 20 cap); it must survive.
    const zebra = field('Zebra Metric', 'measure', 'quantitative', 'real');
    const summary = wideSummary(301, [zebra]);
    const input = buildLlmInput('show me Zebra Metric now', barTemplate(), summary);
    expect(input.fields.some((f) => f.name === 'Zebra Metric')).toBe(true);
  });

  it('rank-2: kind-compatible fields outrank incompatible ones when the ask names nothing', () => {
    // 30 dimensions first, then 5 measures last. Candidate requires ONLY a
    // quantitative slot, so the 5 measures are kind-compatible (rank-2) and the
    // dims are not — all 5 measures must survive the 20 cap.
    const fields: SchemaField[] = [];
    for (let i = 0; i < 30; i++)
      fields.push(field(`Filler Dim ${i}`, 'dimension', 'nominal', 'string'));
    const measures = [0, 1, 2, 3, 4].map((i) =>
      field(`Amount ${i}`, 'measure', 'quantitative', 'real'),
    );
    fields.push(...measures);
    const summary: SchemaSummary = { datasource: 'DS', fields };

    const input = buildLlmInput('show a summary', quantOnlyTemplate(), summary);
    expect(input.fields.length).toBe(20);
    const names = new Set(input.fields.map((f) => f.name));
    for (const m of measures) expect(names.has(m.name)).toBe(true);
  });

  it('passes through unchanged when there are fewer fields than the cap', () => {
    const fields = [
      field('Sales', 'measure', 'quantitative', 'real'),
      field('Region', 'dimension', 'nominal', 'string'),
    ];
    const summary: SchemaSummary = { datasource: 'DS', fields };
    const input = buildLlmInput('bar of Sales by Region', barTemplate(), summary);

    expect(input.fields).toEqual(
      fields.map((f) => ({ name: f.name, role: f.role, type: f.type, datatype: f.datatype })),
    );
    expect(input.more_available).toBeUndefined();
  });

  it('more_available reports the exact withheld count', () => {
    const summary = wideSummary(50, askedFields);
    const input = buildLlmInput(ask, barTemplate(), summary);
    expect(input.fields.length).toBe(20);
    expect(input.more_available?.count).toBe(30);
    expect(input.more_available?.note).toMatch(/hint/i);
  });

  it('respects the maxFields opt param', () => {
    const summary = wideSummary(50, askedFields);
    const input = buildLlmInput(ask, barTemplate(), summary, { maxFields: 10 });
    expect(input.fields.length).toBe(10);
    expect(input.more_available?.count).toBe(40);
  });

  it('is deterministic — same inputs produce byte-identical output', () => {
    const summary = wideSummary(300, askedFields);
    const a = buildLlmInput(ask, barTemplate(), summary);
    const b = buildLlmInput(ask, barTemplate(), summary);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
