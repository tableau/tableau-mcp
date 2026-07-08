import { beforeAll, describe, expect, it } from 'vitest';

import { loadManifests } from './manifest.js';
import type { TemplateManifest } from './manifest-types.js';
import type { SchemaField, SchemaSummary } from './schema-summary.js';
import { type BindingProposal, validateBinding } from './validate.js';

// ── Deterministic Superstore-shaped schema summary ──────────────────
function field(p: {
  columnName: string;
  role: 'dimension' | 'measure';
  type: string;
  datatype: string;
  caption?: string;
  isAggregated?: boolean;
  datasource?: string;
}): SchemaField {
  const bare = p.columnName.replace(/^\[|\]$/g, '');
  const ds = p.datasource ?? 'Superstore';
  return {
    name: p.caption ?? bare,
    caption: p.caption,
    columnName: p.columnName,
    role: p.role,
    type: p.type,
    datatype: p.datatype,
    datasource: ds,
    isAggregated: p.isAggregated ?? false,
    column_ref: `[${ds}].[none:${bare}:nk]`,
  };
}

const SUMMARY: SchemaSummary = {
  datasource: 'Superstore',
  fields: [
    field({ columnName: '[Region]', role: 'dimension', type: 'nominal', datatype: 'string' }),
    field({ columnName: '[Category]', role: 'dimension', type: 'nominal', datatype: 'string' }),
    field({
      columnName: '[Customer Name]',
      role: 'dimension',
      type: 'nominal',
      datatype: 'string',
    }),
    field({ columnName: '[Order Date]', role: 'dimension', type: 'ordinal', datatype: 'date' }),
    field({ columnName: '[Ship Date]', role: 'dimension', type: 'ordinal', datatype: 'date' }),
    field({ columnName: '[Sales]', role: 'measure', type: 'quantitative', datatype: 'real' }),
    field({ columnName: '[Profit]', role: 'measure', type: 'quantitative', datatype: 'real' }),
    field({
      columnName: '[Calculation_9999]',
      role: 'measure',
      type: 'quantitative',
      datatype: 'real',
      caption: 'Profit Ratio',
      isAggregated: true,
    }),
  ],
};

let manifests: Map<string, TemplateManifest>;
beforeAll(() => {
  manifests = loadManifests();
});

describe('binder/validate — gate 1: slot coverage', () => {
  it('no-fire: both required slots bound → ok', () => {
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
  });

  it('fire: missing a required slot → missing-required-slot', () => {
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [{ slot_id: 'region', field: 'Region' }],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.blockers.some((b) => b.code === 'missing-required-slot' && b.slot_id === 'sales'),
      ).toBe(true);
  });

  it('fire: binding to a template-owned calc slot → kind-mismatch', () => {
    const m = manifests.get('correlation-scatter-plot-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'profit_ratio_calc', field: 'Profit' }, // illegal: calc is not bindable
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.blockers.some((b) => b.code === 'kind-mismatch' && b.slot_id === 'profit_ratio_calc'),
      ).toBe(true);
  });
});

describe('binder/validate — gate 2: field resolution', () => {
  it('fire: unknown field → field-not-found (with candidates)', () => {
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Nonexistent Field' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const b = r.blockers.find((x) => x.slot_id === 'region');
      expect(b?.code).toBe('field-not-found');
      expect(Array.isArray(b?.candidates)).toBe(true);
    }
  });

  it('fire: field present in >1 datasource → ambiguous-field', () => {
    const ambiguous: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({
          columnName: '[Region]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'Superstore',
        }),
        field({
          columnName: '[Region]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'Other',
        }),
        field({ columnName: '[Sales]', role: 'measure', type: 'quantitative', datatype: 'real' }),
      ],
    };
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, ambiguous);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.blockers.some((b) => b.code === 'ambiguous-field' && (b.candidates?.length ?? 0) >= 2),
      ).toBe(true);
  });
});

describe('binder/validate — gate 3: kind/role compatibility', () => {
  it('fire: a measure in a categorical slot → kind-mismatch', () => {
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Sales' }, // categorical slot ← measure
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.blockers.some((b) => b.code === 'kind-mismatch' && b.slot_id === 'region')).toBe(
        true,
      );
  });

  it('no-fire: a dimension in a categorical slot resolves cleanly', () => {
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Category' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    expect(validateBinding(m, p, SUMMARY).ok).toBe(true);
  });
});

describe('binder/validate — gate 4: derivation legality', () => {
  // A crafted manifest whose quantitative slot carries a TEMPORAL derivation.
  // gate 3 passes (measure), gate 4 must reject a temporal derivation on a numeric.
  const tempOnMeasure: TemplateManifest = {
    template: 'x-temporal-on-measure',
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: ['x'],
    description: 'test',
    slots: [
      {
        slot_id: 'm',
        template_field: 'Sales',
        derivation: 'yr',
        role: ['cols'],
        kind: 'quantitative',
        bindable: true,
        required: true,
      },
    ],
    calcs: [],
    hazards: [],
  };

  it('fire: temporal derivation on a numeric measure → derivation-illegal', () => {
    const p: BindingProposal = {
      template: tempOnMeasure.template,
      title: 't',
      bindings: [{ slot_id: 'm', field: 'Sales' }],
    };
    const r = validateBinding(tempOnMeasure, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.some((b) => b.code === 'derivation-illegal')).toBe(true);
  });

  it('no-fire: sum on a numeric measure is legal', () => {
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    expect(validateBinding(m, p, SUMMARY).ok).toBe(true);
  });
});

describe('binder/validate — gate 4: min/max on a temporal field is legal (W60 gantt-task-rollup)', () => {
  // gantt-task-rollup-chart authors MIN on its DATE start_date slot (each task's
  // earliest start on a continuous date axis). MIN/MAX over a date is legal Tableau,
  // so the template's OWN manifest must pass the legality gate against a schema with a
  // date-typed start field + a real duration measure. Pre-W60 the gate treated `min`
  // as numeric-only, so it rejected the date slot and the template could never one-shot
  // on ANY schema (confirmed on the Superstore control).
  const GANTT_SCHEMA: SchemaSummary = {
    datasource: 'Projects',
    fields: [
      field({
        columnName: '[Task]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        datasource: 'Projects',
      }),
      field({
        columnName: '[Phase]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        datasource: 'Projects',
      }),
      field({
        columnName: '[Start Date]',
        role: 'dimension',
        type: 'ordinal',
        datatype: 'date',
        datasource: 'Projects',
      }),
      field({
        columnName: '[Duration]',
        role: 'measure',
        type: 'quantitative',
        datatype: 'real',
        datasource: 'Projects',
      }),
    ],
  };

  const ganttProposal = (m: TemplateManifest): BindingProposal => ({
    template: m.template,
    title: 'Task rollup',
    bindings: [
      { slot_id: 'task', field: 'Task' },
      { slot_id: 'start_date', field: 'Start Date' },
      { slot_id: 'duration', field: 'Duration' },
      { slot_id: 'phase', field: 'Phase' },
    ],
  });

  it("gantt-task-rollup's own manifest passes its legality gate (MIN on the date start slot)", () => {
    const m = manifests.get('gantt-task-rollup-chart')!;
    const r = validateBinding(m, ganttProposal(m), GANTT_SCHEMA);
    expect(r.ok).toBe(true);
  });

  it('MIN on a date never fires a derivation-illegal blocker (regression guard)', () => {
    const m = manifests.get('gantt-task-rollup-chart')!;
    const r = validateBinding(m, ganttProposal(m), GANTT_SCHEMA);
    if (!r.ok) {
      expect(r.blockers.some((b) => b.code === 'derivation-illegal')).toBe(false);
    }
  });

  it('a MIN override on a plain STRING dimension is STILL illegal (temporal exemption is date-only)', () => {
    // The exemption is scoped to temporal datatypes: MIN on a non-numeric, non-temporal
    // field must still be rejected so the gate is not broadened to strings.
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region', derivation: 'min' }, // Region is a string dim
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.blockers.some((b) => b.code === 'derivation-illegal' && b.slot_id === 'region'),
      ).toBe(true);
    }
  });
});

describe('binder/validate — gate 4/7: aggregated calc forces usr', () => {
  it("binds an aggregated calc into a quantitative slot as usr (not the slot's sum)", () => {
    const m = manifests.get('kpi-text')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'KPI',
      bindings: [{ slot_id: 'value', field: 'Profit Ratio' }],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.field_mapping['Value']).toBe('[Superstore].[usr:Calculation_9999:qk]');
  });

  it('an override on an aggregated calc is ignored — usr is still forced', () => {
    const m = manifests.get('kpi-text')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'KPI',
      bindings: [{ slot_id: 'value', field: 'Profit Ratio', derivation: 'avg' }],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.field_mapping['Value']).toBe('[Superstore].[usr:Calculation_9999:qk]');
  });
});

describe('binder/validate — derivation override', () => {
  it('legal override on a numeric measure emits the override in the field_mapping value', () => {
    // kpi-text 'value' slot's template default is sum; overriding to avg must
    // emit avg (the template default is not the user's intent).
    const m = manifests.get('kpi-text')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'KPI',
      bindings: [{ slot_id: 'value', field: 'Sales', derivation: 'avg' }],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.field_mapping['Value']).toBe('[Superstore].[avg:Sales:qk]');
  });

  it('illegal override (avg on a string dimension) escalates derivation-illegal', () => {
    // ranking's 'region' slot accepts a categorical string dimension (gate 3
    // passes); an avg override on that string field is illegal (gate 4 fires).
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region', derivation: 'avg' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.blockers.some((b) => b.code === 'derivation-illegal' && b.slot_id === 'region'),
      ).toBe(true);
  });

  it('qualified-key slot: override lands in the value; the key keeps the template derivation', () => {
    // Two quantitative slots reuse one template_field ('Sales') at two authored
    // derivations (sum + avg). Overriding the sum slot to max must emit the
    // override in the VALUE while the qualified KEY stays 'Sales@sum' so the
    // injector still matches the template instance authored as sum.
    const dualAgg: TemplateManifest = {
      template: 'x-dual-agg',
      family: 'specialized',
      readiness: 'GREEN',
      fast_path_eligible: true,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
      datasource_placeholder: true,
      placeholders: ['TITLE', 'DATASOURCE'],
      intent_keywords: ['x'],
      description: 'test',
      slots: [
        {
          slot_id: 'sales_sum',
          template_field: 'Sales',
          derivation: 'sum',
          role: ['cols'],
          kind: 'quantitative',
          bindable: true,
          required: true,
          qualified_key_required: true,
        },
        {
          slot_id: 'sales_avg',
          template_field: 'Sales',
          derivation: 'avg',
          role: ['rows'],
          kind: 'quantitative',
          bindable: true,
          required: true,
          qualified_key_required: true,
        },
      ],
      calcs: [],
      hazards: [],
    };
    const p: BindingProposal = {
      template: dualAgg.template,
      title: 't',
      bindings: [
        { slot_id: 'sales_sum', field: 'Sales', derivation: 'max' },
        { slot_id: 'sales_avg', field: 'Sales' },
      ],
    };
    const r = validateBinding(dualAgg, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.field_mapping['Sales@sum']).toBe('[Superstore].[max:Sales:qk]');
      expect(r.field_mapping['Sales@avg']).toBe('[Superstore].[avg:Sales:qk]');
    }
  });
});

describe('binder/validate — gate 5: base-column consistency + qualified keys', () => {
  // Two slots reuse one template_field at two derivations (yr + mn).
  const heatmap: TemplateManifest = {
    template: 'x-calendar',
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: ['x'],
    description: 'test',
    slots: [
      {
        slot_id: 'od_year',
        template_field: 'Order Date',
        derivation: 'yr',
        role: ['cols'],
        kind: 'temporal',
        bindable: true,
        required: true,
        qualified_key_required: true,
      },
      {
        slot_id: 'od_month',
        template_field: 'Order Date',
        derivation: 'mn',
        role: ['rows'],
        kind: 'temporal',
        bindable: true,
        required: true,
        qualified_key_required: true,
      },
    ],
    calcs: [],
    hazards: [],
  };

  it('no-fire: both derivations bind the SAME base column → two qualified keys', () => {
    const p: BindingProposal = {
      template: heatmap.template,
      title: 't',
      bindings: [
        { slot_id: 'od_year', field: 'Order Date' },
        { slot_id: 'od_month', field: 'Order Date' },
      ],
    };
    const r = validateBinding(heatmap, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.field_mapping['Order Date@yr']).toBe('[Superstore].[yr:Order Date:ok]');
      expect(r.field_mapping['Order Date@mn']).toBe('[Superstore].[mn:Order Date:ok]');
    }
  });

  it('fire: derivations of one template_field map to different base columns → base-column-conflict', () => {
    const p: BindingProposal = {
      template: heatmap.template,
      title: 't',
      bindings: [
        { slot_id: 'od_year', field: 'Order Date' },
        { slot_id: 'od_month', field: 'Ship Date' },
      ],
    };
    const r = validateBinding(heatmap, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blockers.some((b) => b.code === 'base-column-conflict')).toBe(true);
  });
});

describe('binder/validate — cross-datasource binding gate', () => {
  // P1-2: the injector substitutes a SINGLE {{DATASOURCE}} and rewrites every
  // bound field onto it (templates.ts). If bound fields resolve to different
  // datasources the fast path must fail closed — otherwise fields from a
  // secondary datasource are silently repointed to the primary.
  it('fire: fields resolve to different datasources → cross-datasource-binding', () => {
    const mixed: SchemaSummary = {
      datasource: 'DS_A',
      fields: [
        field({
          columnName: '[Region]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'DS_A',
        }),
        field({
          columnName: '[Sales]',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'DS_B',
        }),
      ],
    };
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' }, // resolves in DS_A
        { slot_id: 'sales', field: 'Sales' }, // resolves in DS_B
      ],
    };
    const r = validateBinding(m, p, mixed);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const b = r.blockers.find((x) => x.code === 'cross-datasource-binding');
      expect(b).toBeDefined();
      // teaching blocker names both datasources
      expect(b?.detail).toContain('DS_A');
      expect(b?.detail).toContain('DS_B');
    }
  });

  it('no-fire: all bound fields share one datasource even when another exists', () => {
    const twoDs: SchemaSummary = {
      datasource: 'DS_A',
      fields: [
        field({
          columnName: '[Region]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'DS_A',
        }),
        field({
          columnName: '[Sales]',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'DS_A',
        }),
        // an unrelated field in a second datasource that is NOT bound
        field({
          columnName: '[Other]',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'DS_B',
        }),
      ],
    };
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, twoDs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datasource).toBe('DS_A');
  });
});

describe('binder/validate — gate 6: calc dependency closure', () => {
  const calcDep: TemplateManifest = {
    template: 'x-calc-dep',
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: ['x'],
    description: 'test',
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
      },
    ],
    hazards: [],
  };

  it('fire: an optional dependency left unbound → calc-dependency-unmet', () => {
    // m2 is optional so gate 1 does not fire, isolating the calc-closure gate.
    const p: BindingProposal = {
      template: calcDep.template,
      title: 't',
      bindings: [{ slot_id: 'm1', field: 'Sales' }],
    };
    const r = validateBinding(calcDep, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(
        r.blockers.some((b) => b.code === 'calc-dependency-unmet' && b.slot_id === 'ratio'),
      ).toBe(true);
  });

  it('no-fire: all dependencies bound → ok', () => {
    const p: BindingProposal = {
      template: calcDep.template,
      title: 't',
      bindings: [
        { slot_id: 'm1', field: 'Sales' },
        { slot_id: 'm2', field: 'Profit' },
      ],
    };
    expect(validateBinding(calcDep, p, SUMMARY).ok).toBe(true);
  });
});

describe('binder/validate — gate 6: first-class calc inputs (H3)', () => {
  // A required calc whose first-class `inputs` reference m1 (required) and m2
  // (OPTIONAL). With m2 unbound the calc would dangle; the blocker must name the
  // offending formula REF, not just the slot id (ref-level diagnostics).
  const calcInputs: TemplateManifest = {
    template: 'x-calc-inputs',
    family: 'specialized',
    readiness: 'GREEN',
    fast_path_eligible: true,
    fast_path_blockers: [],
    portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
    datasource_placeholder: true,
    placeholders: ['TITLE', 'DATASOURCE'],
    intent_keywords: ['x'],
    description: 'test',
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

  it('fire: a required calc input whose slot is unbound → calc-dependency-unmet naming the ref', () => {
    const p: BindingProposal = {
      template: calcInputs.template,
      title: 't',
      bindings: [{ slot_id: 'm1', field: 'Sales' }],
    };
    const r = validateBinding(calcInputs, p, SUMMARY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const b = r.blockers.find((x) => x.code === 'calc-dependency-unmet' && x.slot_id === 'ratio');
      expect(b).toBeDefined();
      expect(b!.detail).toContain('[M2]');
    }
  });

  it('no-fire: a required template-internal input is NOT treated as a missing binding', () => {
    // The calc references a field the template OWNS ([Const]); the binder must not
    // demand a binding for it. Only the real slot input (M1) must bind.
    const internal: TemplateManifest = {
      ...calcInputs,
      calcs: [
        {
          ...calcInputs.calcs[0],
          formula: 'SUM([M1]) + [Const]',
          formula_refs: ['M1', 'Const'],
          depends_on_slots: ['m1'],
          inputs: [
            {
              ref: 'M1',
              slot_id: 'm1',
              slot_kind: 'quantitative',
              required: true,
              template_internal: false,
            },
            {
              ref: 'Const',
              slot_id: null,
              slot_kind: 'calc',
              required: true,
              template_internal: true,
            },
          ],
        },
      ],
    };
    const p: BindingProposal = {
      template: internal.template,
      title: 't',
      bindings: [{ slot_id: 'm1', field: 'Sales' }],
    };
    const r = validateBinding(internal, p, SUMMARY);
    expect(r.ok).toBe(true);
  });

  it('no-fire: all first-class inputs bound → ok', () => {
    const p: BindingProposal = {
      template: calcInputs.template,
      title: 't',
      bindings: [
        { slot_id: 'm1', field: 'Sales' },
        { slot_id: 'm2', field: 'Profit' },
      ],
    };
    expect(validateBinding(calcInputs, p, SUMMARY).ok).toBe(true);
  });
});

describe('binder/validate — gate 7: temporal suffix', () => {
  // P1-3: the column-instance pivot suffix for a TRUNCATED date slot must be the
  // continuous ':qk' the template authored, not derived from the field's `type`.
  // A top-level date dimension is often type="ordinal", so deriving from type
  // alone drifts tmn/tqr/tdy to ':ok' and breaks the template contract.
  it('truncated date slot emits :qk even when the resolved date field is ordinal', () => {
    const m = manifests.get('trend-line-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'Trend',
      bindings: [
        { slot_id: 'order_date', field: 'Order Date' }, // type=ordinal in SUMMARY
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    // Canonical Month-Trunc short-form is 'tmn' (the real one Tableau writes);
    // the binder emits it verbatim (H3.2 tmn/tmo reconciliation).
    if (r.ok) expect(r.field_mapping['Order Date']).toBe('[Superstore].[tmn:Order Date:qk]');
  });

  it('date-part slot keeps the discrete suffix from the field type (ordinal -> :ok)', () => {
    const datePart: TemplateManifest = {
      template: 'x-date-part',
      family: 'specialized',
      readiness: 'GREEN',
      fast_path_eligible: true,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-04' },
      datasource_placeholder: true,
      placeholders: ['TITLE', 'DATASOURCE'],
      intent_keywords: ['x'],
      description: 'test',
      slots: [
        {
          slot_id: 'od',
          template_field: 'Order Date',
          derivation: 'yr',
          role: ['cols'],
          kind: 'temporal',
          bindable: true,
          required: true,
        },
      ],
      calcs: [],
      hazards: [],
    };
    const p: BindingProposal = {
      template: datePart.template,
      title: 't',
      bindings: [{ slot_id: 'od', field: 'Order Date' }],
    };
    const r = validateBinding(datePart, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.field_mapping['Order Date']).toBe('[Superstore].[yr:Order Date:ok]');
  });
});

describe('binder/validate — avoid_when warnings (H3.2)', () => {
  // A bound result carries matched avoid_when guidance as advisory WARNINGS when
  // an `ask` is supplied — never as blockers.
  it('attaches the matched avoid_when caution as a warning on a bound pie result', () => {
    const m = manifests.get('part-to-whole-pie-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY, 'pie chart for a precise comparison of Sales');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings && r.warnings.length > 0).toBe(true);
      expect(r.warnings!.some((w) => /precise/i.test(w))).toBe(true);
    }
  });

  it('no ask supplied → no warnings field (unchanged behavior for existing callers)', () => {
    const m = manifests.get('part-to-whole-pie-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toBeUndefined();
  });

  it('clean pie ask (no caution terms) → bound with no warnings', () => {
    const m = manifests.get('part-to-whole-pie-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY, 'pie chart of Sales by Region');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toBeUndefined();
  });
});

describe('binder/validate — field_mapping covers calc inputs (H3, item 4)', () => {
  // The bare field-name part of a field_mapping KEY (strip a `@deriv` qualifier).
  // This is exactly what templates.ts derives baseTarget from, so rewriteFormulaFieldRefs
  // can resolve a bare [ref] token iff its ref appears here.
  function keyFieldParts(fm: Record<string, string>): Set<string> {
    const out = new Set<string>();
    for (const k of Object.keys(fm)) {
      const at = k.lastIndexOf('@');
      out.add(at > 0 ? k.slice(0, at) : k);
    }
    return out;
  }

  it('scatter: every slot-referencing calc input ref is a field_mapping key (engine can rewrite the formula)', () => {
    const m = manifests.get('correlation-scatter-plot-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'Scatter',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const covered = keyFieldParts(r.field_mapping);
      for (const calc of m.calcs) {
        for (const input of calc.inputs ?? []) {
          if (input.template_internal) continue;
          expect(
            covered.has(input.ref),
            `calc '${calc.slot_id}' input [${input.ref}] must be a field_mapping key`,
          ).toBe(true);
        }
      }
    }
  });

  it('floating-bars: every slot-referencing calc input ref is covered by the emitted field_mapping', () => {
    // W28-D byte-for-byte sync (re-baseline): ww-floating-bars now mirrors the factory
    // THREE-calc variant verbatim — a SPLIT actual-score calc (Calculation_ActualScore),
    // the span/size calc (Calculation_GanttSize), and a SIGN over/under COLOR calc
    // (Calculation_OverUnder). Color is now a TEMPLATE-OWNED calc, NOT a bindable slot, so
    // the factory-true bindable set is exactly THREE slots (row_dimension / line_measure /
    // actual_input); the previously shipped rung-1+format variant's bound Segment
    // `color_dimension` slot is GONE (binding it would name an unknown slot → gate-1 fail).
    // The coverage LOGIC below is unchanged from the scatter sibling, but it now iterates the
    // factory calcs' REAL inputs — actual_score_calc's bindable [Actual Input] and the
    // bar_size/over_under calcs' bindable [Reference Value] (the template-internal
    // [Calculation_ActualScore] ref is skipped) — so it now ACTIVELY proves every
    // slot-referencing calc input ref lands in the emitted field_mapping (the strengthening
    // the deferred sync promised), rather than iterating zero inputs.
    const m = manifests.get('ww-floating-bars')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'Gantt',
      bindings: [
        { slot_id: 'row_dimension', field: 'Region' },
        { slot_id: 'line_measure', field: 'Sales' },
        { slot_id: 'actual_input', field: 'Category' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const covered = keyFieldParts(r.field_mapping);
      for (const calc of m.calcs) {
        for (const input of calc.inputs ?? []) {
          if (input.template_internal) continue;
          expect(
            covered.has(input.ref),
            `calc '${calc.slot_id}' input [${input.ref}] covered`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('binder/validate — gate 7: full scatter emission', () => {
  it('emits the exact 4-slot field_mapping (calc excluded)', () => {
    const m = manifests.get('correlation-scatter-plot-chart')!;
    const p: BindingProposal = {
      template: m.template,
      title: 'Scatter',
      bindings: [
        { slot_id: 'sales', field: 'Sales' },
        { slot_id: 'profit', field: 'Profit' },
        { slot_id: 'customer_name', field: 'Customer Name' },
        { slot_id: 'region', field: 'Region' },
      ],
    };
    const r = validateBinding(m, p, SUMMARY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datasource).toBe('Superstore');
      expect(r.field_mapping).toEqual({
        Sales: '[Superstore].[sum:Sales:qk]',
        Profit: '[Superstore].[sum:Profit:qk]',
        'Customer Name': '[Superstore].[none:Customer Name:nk]',
        Region: '[Superstore].[none:Region:nk]',
      });
    }
  });
});

describe('binder/validate — XML escaping in the emitted payload (M10 Finding 1)', () => {
  const HOSTILE_DS = "Evil'/><datasource name='pwn";
  const ESCAPED_DS = 'Evil&apos;/&gt;&lt;datasource name=&apos;pwn';

  it('(a) escapes a hostile datasource name in datasource AND every field_mapping value', () => {
    const hostile: SchemaSummary = {
      datasource: HOSTILE_DS,
      fields: [
        field({
          columnName: '[Region]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: HOSTILE_DS,
        }),
        field({
          columnName: '[Sales]',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: HOSTILE_DS,
        }),
      ],
    };
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, hostile);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datasource).toBe(ESCAPED_DS);
      const values = Object.values(r.field_mapping);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) {
        expect(v).toContain(ESCAPED_DS);
        // The XML-structure-injection payload is neutralized in every value.
        expect(v).not.toContain('<datasource');
        expect(v).not.toContain("'");
        expect(v).not.toContain('>');
      }
    }
  });

  it('(c) fidelity pin: a clean schema passes through byte-identical (brackets/hyphens/slashes NOT escaped)', () => {
    // Sub-Category, State/Province and the bracketed ref syntax contain NO XML metachars.
    const clean: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({
          columnName: '[Sub-Category]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
        }),
        field({
          columnName: '[State/Province]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
        }),
        field({ columnName: '[Sales]', role: 'measure', type: 'quantitative', datatype: 'real' }),
      ],
    };
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Sub-Category' },
        { slot_id: 'sales', field: 'Sales' },
      ],
    };
    const r = validateBinding(m, p, clean);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datasource).toBe('Superstore');
      const values = Object.values(r.field_mapping);
      // Byte-identical: the pre-fix expectation (brackets + hyphen intact, no entities).
      expect(values).toContain('[Superstore].[none:Sub-Category:nk]');
      expect(values).toContain('[Superstore].[sum:Sales:qk]');
      for (const v of values) expect(v).not.toContain('&');
    }
  });

  it("(d) apostrophe-bearing real-world-ish name (O'Brien Sales) escapes the quote only", () => {
    const s: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({ columnName: '[Region]', role: 'dimension', type: 'nominal', datatype: 'string' }),
        field({
          columnName: "[O'Brien Sales]",
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
        }),
      ],
    };
    const m = manifests.get('ranking-ordered-bar')!;
    const p: BindingProposal = {
      template: m.template,
      title: 't',
      bindings: [
        { slot_id: 'region', field: 'Region' },
        { slot_id: 'sales', field: "O'Brien Sales" },
      ],
    };
    const r = validateBinding(m, p, s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const values = Object.values(r.field_mapping);
      expect(values).toContain('[Superstore].[sum:O&apos;Brien Sales:qk]');
      // Only the apostrophe changed; the clean Region value is untouched.
      expect(values).toContain('[Superstore].[none:Region:nk]');
    }
  });
});
