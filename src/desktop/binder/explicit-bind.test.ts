import { describe, expect, it } from 'vitest';

import { bindExplicitTemplate, schemaSummaryFromAvailableFields } from './explicit-bind.js';
import type { TemplateManifest } from './manifest-types.js';
import type { SchemaField, SchemaSummary } from './schema-summary.js';

function field(p: {
  name: string;
  role: 'dimension' | 'measure';
  type: string;
  datatype: string;
  refDerivation?: string;
}): SchemaField {
  const suffix = p.type === 'quantitative' ? 'qk' : p.type === 'ordinal' ? 'ok' : 'nk';
  const deriv = p.refDerivation ?? (p.role === 'measure' ? 'sum' : 'none');
  return {
    name: p.name,
    columnName: `[${p.name}]`,
    role: p.role,
    type: p.type,
    datatype: p.datatype,
    datasource: 'Superstore',
    isAggregated: false,
    column_ref: `[Superstore].[${deriv}:${p.name}:${suffix}]`,
  };
}

const SUMMARY: SchemaSummary = {
  datasource: 'Superstore',
  fields: [
    field({ name: 'Longitude', role: 'measure', type: 'quantitative', datatype: 'real' }),
    field({ name: 'Latitude', role: 'measure', type: 'quantitative', datatype: 'real' }),
    field({ name: 'City', role: 'dimension', type: 'nominal', datatype: 'string' }),
    field({ name: 'Sales', role: 'measure', type: 'quantitative', datatype: 'real' }),
    field({ name: 'Order Date', role: 'dimension', type: 'ordinal', datatype: 'date' }),
    field({ name: 'Segment', role: 'dimension', type: 'nominal', datatype: 'string' }),
  ],
};

const LATLON = {
  template: 'x-latlon',
  family: 'spatial',
  readiness: 'YELLOW',
  fast_path_eligible: false,
  fast_path_blockers: [],
  portability_evidence: { fixture_bind: true, render_verified: 'none' },
  datasource_placeholder: true,
  placeholders: ['TITLE', 'DATASOURCE'],
  intent_keywords: ['latlon'],
  description: 'test lat/lon map',
  slots: [
    {
      slot_id: 'longitude',
      template_field: 'Longitude',
      derivation: 'avg',
      role: ['cols'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'latitude',
      template_field: 'Latitude',
      derivation: 'avg',
      role: ['rows'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'detail',
      template_field: 'Detail',
      derivation: 'none',
      role: ['detail'],
      kind: 'categorical',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'measure',
      template_field: 'Measure',
      derivation: 'sum',
      role: ['size'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
  ],
  calcs: [],
  hazards: [],
} as unknown as TemplateManifest;

const manifests = (m: TemplateManifest): Map<string, TemplateManifest> =>
  new Map([[m.template, m]]);

describe('bindExplicitTemplate', () => {
  it('emits manifest derivations over caller SUM refs', () => {
    const result = bindExplicitTemplate(
      'x-latlon',
      [
        '[Superstore].[sum:Longitude:qk]',
        '[Superstore].[sum:Latitude:qk]',
        '[Superstore].[none:City:nk]',
        '[Superstore].[sum:Sales:qk]',
      ],
      SUMMARY,
      { manifests: manifests(LATLON) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping.Longitude).toBe('[Superstore].[avg:Longitude:qk]');
      expect(result.fieldMapping.Latitude).toBe('[Superstore].[avg:Latitude:qk]');
      expect(result.fieldMapping.Detail).toBe('[Superstore].[none:City:nk]');
      expect(result.fieldMapping.Measure).toBe('[Superstore].[sum:Sales:qk]');
      expect(result.passthrough).toBe(false);
    }
  });

  it('passes through unchanged with warning when the template has no manifest', () => {
    const mapping = { Sales: '[Superstore].[sum:Sales:qk]' };
    const result = bindExplicitTemplate('missing-template', mapping, SUMMARY, {
      manifests: new Map(),
      datasource: 'Superstore',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.passthrough).toBe(true);
      expect(result.fieldMapping).toEqual(mapping);
      expect(result.warnings.some((w) => w.includes('no-manifest'))).toBe(true);
    }
  });

  it('surfaces ineligible render evidence and hazards as warnings', () => {
    const hazardous = {
      ...LATLON,
      hazards: [{ code: 'coordinate-slot-affinity-unproven', detail: 'coordinate slots can swap' }],
    } as unknown as TemplateManifest;

    const result = bindExplicitTemplate(
      'x-latlon',
      [
        '[Superstore].[sum:Longitude:qk]',
        '[Superstore].[sum:Latitude:qk]',
        '[Superstore].[none:City:nk]',
        '[Superstore].[sum:Sales:qk]',
      ],
      SUMMARY,
      { manifests: manifests(hazardous) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('fast_path_eligible:false'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('render_verified:none'))).toBe(true);
      expect(
        result.warnings.some((w) => w.includes('hazard:coordinate-slot-affinity-unproven')),
      ).toBe(true);
    }
  });

  it('returns FIX-style blockers for missing required manifest slots', () => {
    const result = bindExplicitTemplate(
      'x-latlon',
      { Longitude: '[Superstore].[sum:Longitude:qk]' },
      SUMMARY,
      { manifests: manifests(LATLON) },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.some((b) => b.code === 'missing-required-slot')).toBe(true);
      expect(result.errors.every((e) => e.fix.length > 0)).toBe(true);
    }
  });

  it('handles qualified-key slots for one field reused at two derivations', () => {
    const highlight = {
      ...LATLON,
      template: 'x-highlight',
      family: 'correlation',
      intent_keywords: ['highlight'],
      slots: [
        {
          slot_id: 'order_date_month',
          template_field: 'Order Date',
          derivation: 'mn',
          role: ['rows'],
          kind: 'temporal',
          bindable: true,
          required: true,
          qualified_key_required: true,
        },
        {
          slot_id: 'segment',
          template_field: 'Segment',
          derivation: 'none',
          role: ['cols'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
        {
          slot_id: 'order_date_year',
          template_field: 'Order Date',
          derivation: 'yr',
          role: ['cols'],
          kind: 'temporal',
          bindable: true,
          required: true,
          qualified_key_required: true,
        },
      ],
    } as unknown as TemplateManifest;

    const result = bindExplicitTemplate(
      'x-highlight',
      {
        'Order Date@mn': '[Superstore].[none:Order Date:ok]',
        Segment: '[Superstore].[none:Segment:nk]',
        'Order Date@yr': '[Superstore].[none:Order Date:ok]',
      },
      SUMMARY,
      { manifests: manifests(highlight) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping['Order Date@mn']).toBe('[Superstore].[mn:Order Date:ok]');
      expect(result.fieldMapping['Order Date@yr']).toBe('[Superstore].[yr:Order Date:ok]');
    }
  });
});

describe('schemaSummaryFromAvailableFields', () => {
  it('adapts available-fields shape and picks the majority datasource', () => {
    const summary = schemaSummaryFromAvailableFields([
      {
        datasource: 'DS1',
        columnName: '[Sales]',
        role: 'measure',
        type: 'quantitative',
        datatype: 'real',
        column_ref: '[DS1].[sum:Sales:qk]',
      },
      {
        datasource: 'DS1',
        columnName: '[Region]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        column_ref: '[DS1].[none:Region:nk]',
      },
      {
        datasource: 'DS2',
        columnName: '[Other]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        column_ref: '[DS2].[none:Other:nk]',
      },
    ]);

    expect(summary.datasource).toBe('DS1');
    expect(summary.fields).toHaveLength(3);
    expect(summary.fields[0].name).toBe('Sales');
  });
});
