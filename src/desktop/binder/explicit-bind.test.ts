import { describe, expect, it } from 'vitest';

import { bindExplicitTemplate, schemaSummaryFromAvailableFields } from './explicit-bind.js';
import type { RuntimeTemplateDescriptor, TemplateBindingContract } from './manifest-types.js';
import type { SchemaField, SchemaSummary } from './schema-summary.js';

function field(p: {
  name: string;
  role: 'dimension' | 'measure';
  type: string;
  datatype: string;
  datasource?: string;
  refDerivation?: string;
  semanticRole?: string;
  isGroup?: boolean;
}): SchemaField {
  const suffix = p.type === 'quantitative' ? 'qk' : p.type === 'ordinal' ? 'ok' : 'nk';
  const deriv = p.refDerivation ?? (p.role === 'measure' ? 'sum' : 'none');
  const datasource = p.datasource ?? 'Superstore';
  return {
    name: p.name,
    columnName: `[${p.name}]`,
    role: p.role,
    type: p.type,
    datatype: p.datatype,
    ...(p.semanticRole ? { semanticRole: p.semanticRole } : {}),
    datasource,
    isAggregated: false,
    ...(p.isGroup ? { isGroup: true } : {}),
    column_ref: `[${datasource}].[${deriv}:${p.name}:${suffix}]`,
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
  fast_path_eligible: false,
  fast_path_blockers: [],
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
} satisfies RuntimeTemplateDescriptor;

const manifests = (m: RuntimeTemplateDescriptor): Map<string, RuntimeTemplateDescriptor> =>
  new Map([[m.template, m]]);

const SCATTER = {
  template: 'correlation-scatter-plot-chart',
  family: 'correlation',
  fast_path_eligible: true,
  fast_path_blockers: [],
  intent_keywords: ['scatter', 'correlation', 'vs'],
  description: 'two measures by a categorical detail grain',
  slots: [
    {
      slot_id: 'sales',
      template_field: 'Sales',
      derivation: 'sum',
      role: ['cols', 'formula-input'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'profit',
      template_field: 'Profit',
      derivation: 'sum',
      role: ['rows', 'formula-input'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'customer_name',
      template_field: 'Customer Name',
      derivation: 'none',
      role: ['detail'],
      kind: 'categorical',
      bindable: true,
      required: false,
    },
    {
      slot_id: 'region',
      template_field: 'Region',
      derivation: 'none',
      role: ['detail'],
      kind: 'categorical',
      bindable: true,
      required: true,
    },
  ],
  calcs: [],
} satisfies RuntimeTemplateDescriptor;
const SCATTER_MANIFESTS = manifests(SCATTER);

const KPI = {
  template: 'kpi-text',
  family: 'magnitude',
  fast_path_eligible: true,
  fast_path_blockers: [],
  intent_keywords: ['kpi'],
  description: 'single KPI value',
  slots: [
    {
      slot_id: 'field_base_1',
      template_field: '{{field_base_1}}',
      derivation: 'sum',
      role: ['text'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
  ],
  calcs: [],
} satisfies RuntimeTemplateDescriptor;

describe('bindExplicitTemplate', () => {
  it.each([
    ['no fields', []],
    ['more than one field', ['[Superstore].[sum:Sales:qk]', '[Superstore].[sum:Longitude:qk]']],
  ])('requires exactly one ordered field for kpi-text when given %s', (_, fields) => {
    const result = bindExplicitTemplate(KPI.template, fields, SUMMARY, {
      manifests: manifests(KPI),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toContainEqual(
        expect.objectContaining({
          code: 'kind-mismatch',
          detail: expect.stringContaining('exactly one field'),
        }),
      );
    }
  });

  it('keeps a single ordered field valid for kpi-text', () => {
    const result = bindExplicitTemplate(KPI.template, ['[Superstore].[sum:Sales:qk]'], SUMMARY, {
      manifests: manifests(KPI),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping).toEqual({
        '{{field_base_1}}': '[Superstore].[sum:Sales:qk]',
      });
    }
  });

  it('rejects a kpi-text field mapping with a competing extra key', () => {
    const result = bindExplicitTemplate(
      KPI.template,
      {
        field_base_1: '[Superstore].[sum:Sales:qk]',
        competing_metric: '[Superstore].[sum:Longitude:qk]',
      },
      SUMMARY,
      { manifests: manifests(KPI) },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([
        expect.objectContaining({
          code: 'kind-mismatch',
          detail: expect.stringContaining('exactly one field'),
        }),
      ]);
      expect(result.blockers[0]?.detail).toContain('received 2');
    }
  });

  it('preserves an exact qualified ref when the same field name exists in two datasources', () => {
    const contract: TemplateBindingContract = {
      template: 'duplicate-region',
      slots: [
        {
          slot_id: 'region',
          template_field: 'Region',
          derivation: 'none',
          role: ['rows'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
      ],
      calcs: [],
    };
    const schema: SchemaSummary = {
      datasource: 'DS_A',
      fields: [
        field({
          name: 'Region',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'DS_A',
        }),
        field({
          name: 'Region',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'DS_B',
        }),
      ],
    };

    const result = bindExplicitTemplate(
      contract.template,
      { region: '[DS_B].[none:Region:nk]' },
      schema,
      { contract, datasource: 'DS_A' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.datasource).toBe('DS_B');
    expect(result.fieldMapping).toEqual({ Region: '[DS_B].[none:Region:nk]' });

    const orderedResult = bindExplicitTemplate(
      contract.template,
      ['[DS_B].[none:Region:nk]'],
      schema,
      { contract, datasource: 'DS_A' },
    );
    expect(orderedResult.ok).toBe(true);
    if (!orderedResult.ok) return;
    expect(orderedResult.datasource).toBe('DS_B');
    expect(orderedResult.fieldMapping).toEqual({ Region: '[DS_B].[none:Region:nk]' });
  });

  it.each([
    ['ctd', 'qk'],
    ['ctd', 'ok'],
    ['cnt', 'qk'],
    ['attr', 'nk'],
    ['attr', 'ok'],
    ['attr', 'qk'],
  ] as const)(
    'allows %s over a string dimension and preserves the authored %s output role',
    (derivation, instanceRole) => {
      const contract: TemplateBindingContract = {
        template: `string-${derivation}-${instanceRole}`,
        slots: [
          {
            slot_id: 'field_base_1',
            template_field: '{{field_base_1}}',
            derivation,
            instance_role: instanceRole,
            role: ['rows'],
            kind: 'categorical',
            bindable: true,
            required: true,
          },
        ],
        calcs: [],
      };
      const schema: SchemaSummary = {
        datasource: 'Superstore',
        fields: [field({ name: 'Movie', role: 'dimension', type: 'nominal', datatype: 'string' })],
      };

      const result = bindExplicitTemplate(
        contract.template,
        { field_base_1: '[Superstore].[none:Movie:nk]' },
        schema,
        { contract, datasource: 'Superstore' },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.fieldMapping).toEqual({
        '{{field_base_1}}': `[Superstore].[${derivation}:Movie:${instanceRole}]`,
      });
    },
  );

  it('binds a neutral runtime contract without synthesizing manifest policy', () => {
    const contract: TemplateBindingContract = {
      template: LATLON.template,
      slots: LATLON.slots,
      calcs: [],
    };
    const result = bindExplicitTemplate(
      contract.template,
      {
        longitude: '[Superstore].[sum:Longitude:qk]',
        latitude: '[Superstore].[sum:Latitude:qk]',
        detail: '[Superstore].[none:City:nk]',
        measure: '[Superstore].[sum:Sales:qk]',
      },
      SUMMARY,
      { contract, datasource: 'Superstore' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.passthrough).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(result.fieldMapping).toEqual({
        Longitude: '[Superstore].[avg:Longitude:qk]',
        Latitude: '[Superstore].[avg:Latitude:qk]',
        Detail: '[Superstore].[none:City:nk]',
        Measure: '[Superstore].[sum:Sales:qk]',
      });
    }
  });

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

  it('fails closed when no TBM-derived contract is supplied', () => {
    const mapping = { Sales: '[Superstore].[sum:Sales:qk]' };
    const result = bindExplicitTemplate('missing-template', mapping, SUMMARY, {
      manifests: new Map(),
      datasource: 'Superstore',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers).toEqual([expect.objectContaining({ code: 'template-not-found' })]);
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

  it('does not auto-fill omitted slots from values under unknown fieldMapping keys', () => {
    const result = bindExplicitTemplate(
      'x-latlon',
      {
        Longitude: '[Superstore].[sum:Longitude:qk]',
        notLatitude: '[Superstore].[sum:Latitude:qk]',
        notDetail: '[Superstore].[none:City:nk]',
        notMeasure: '[Superstore].[sum:Sales:qk]',
      },
      SUMMARY,
      { manifests: manifests(LATLON) },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockers.filter((blocker) => blocker.code === 'missing-required-slot')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slot_id: 'latitude' }),
          expect.objectContaining({ slot_id: 'detail' }),
          expect.objectContaining({ slot_id: 'measure' }),
        ]),
      );
    }
  });

  it('ignores an extra unknown fieldMapping key for an ordinary template', () => {
    const result = bindExplicitTemplate(
      'x-latlon',
      {
        longitude: '[Superstore].[sum:Longitude:qk]',
        latitude: '[Superstore].[sum:Latitude:qk]',
        detail: '[Superstore].[none:City:nk]',
        measure: '[Superstore].[sum:Sales:qk]',
        ignored: '[Superstore].[none:Segment:nk]',
      },
      SUMMARY,
      { manifests: manifests(LATLON) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping).toEqual({
        Longitude: '[Superstore].[avg:Longitude:qk]',
        Latitude: '[Superstore].[avg:Latitude:qk]',
        Detail: '[Superstore].[none:City:nk]',
        Measure: '[Superstore].[sum:Sales:qk]',
      });
    }
  });

  it('ranks a matching semantic geo concept ahead of schema order for ordered input', () => {
    const geoManifest = {
      ...LATLON,
      template: 'x-city-map',
      slots: [
        {
          slot_id: 'city',
          template_field: '{{field_base_1}}',
          derivation: 'none',
          role: ['lod'],
          kind: 'geo',
          bindable: true,
          required: true,
        },
      ],
    } as unknown as RuntimeTemplateDescriptor;
    const geoSummary: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({
          name: 'Country',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          semanticRole: '[Country].[Name]',
        }),
        field({
          name: 'City',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          semanticRole: '[City].[Name]',
        }),
      ],
    };

    const result = bindExplicitTemplate(
      'x-city-map',
      geoSummary.fields.map((candidate) => candidate.column_ref),
      geoSummary,
      { manifests: manifests(geoManifest) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping['{{field_base_1}}']).toBe('[Superstore].[none:City:nk]');
      expect(result.fieldMetadata['{{field_base_1}}']?.semanticRole).toBe('[City].[Name]');
    }
  });

  it('skips dataset-specific groups during ordered auto-mapping', () => {
    const oneCategory = {
      ...LATLON,
      template: 'x-category',
      slots: [
        {
          slot_id: 'category',
          template_field: '{{field_base_1}}',
          derivation: 'none',
          role: ['rows'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
      ],
    } as unknown as RuntimeTemplateDescriptor;
    const group = field({
      name: 'Region Group',
      role: 'dimension',
      type: 'nominal',
      datatype: 'string',
      isGroup: true,
    });
    const region = field({
      name: 'Region',
      role: 'dimension',
      type: 'nominal',
      datatype: 'string',
    });
    const schema = { datasource: 'Superstore', fields: [group, region] };

    const result = bindExplicitTemplate(
      'x-category',
      [group.column_ref, region.column_ref],
      schema,
      { manifests: manifests(oneCategory) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping['{{field_base_1}}']).toBe('[Superstore].[none:Region:nk]');
    }
  });

  it('does not count groups when reserving the only usable category for a required slot', () => {
    const optionalThenRequired = {
      ...LATLON,
      template: 'x-category-reservation',
      slots: [
        {
          slot_id: 'optional_detail',
          template_field: '{{field_base_1}}',
          derivation: 'none',
          role: ['detail'],
          kind: 'categorical',
          bindable: true,
          required: false,
        },
        {
          slot_id: 'required_axis',
          template_field: '{{field_base_2}}',
          derivation: 'none',
          role: ['rows'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
      ],
    } as unknown as RuntimeTemplateDescriptor;
    const group = field({
      name: 'Region Group',
      role: 'dimension',
      type: 'nominal',
      datatype: 'string',
      isGroup: true,
    });
    const region = field({
      name: 'Region',
      role: 'dimension',
      type: 'nominal',
      datatype: 'string',
    });
    const schema = { datasource: 'Superstore', fields: [group, region] };

    const result = bindExplicitTemplate(
      'x-category-reservation',
      [group.column_ref, region.column_ref],
      schema,
      { manifests: manifests(optionalThenRequired) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping).not.toHaveProperty('{{field_base_1}}');
      expect(result.fieldMapping['{{field_base_2}}']).toBe('[Superstore].[none:Region:nk]');
    }
  });

  it('warns which fields landed on swappable categorical slots', () => {
    const scatterSummary: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({ name: 'Sales', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({ name: 'Profit', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({ name: 'City', role: 'dimension', type: 'nominal', datatype: 'string' }),
        field({ name: 'Segment', role: 'dimension', type: 'nominal', datatype: 'string' }),
      ],
    };

    const result = bindExplicitTemplate(
      'correlation-scatter-plot-chart',
      scatterSummary.fields.map((candidate) => candidate.column_ref),
      scatterSummary,
      { manifests: SCATTER_MANIFESTS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContain(
        "Ambiguous categorical assignment: field 'City' landed on slot 'customer_name'; field 'Segment' landed on slot 'region'. These categorical sources fit either slot and could swap when field order changes.",
      );
    }
  });

  it('uses categorical name affinity when both scatter detail fields are supplied', () => {
    const scatterSummary: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({ name: 'Profit', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({ name: 'Sales', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({
          name: 'Customer Name',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
        }),
        field({ name: 'Region', role: 'dimension', type: 'nominal', datatype: 'string' }),
      ],
    };

    const result = bindExplicitTemplate(
      'correlation-scatter-plot-chart',
      scatterSummary.fields.map((candidate) => candidate.column_ref),
      scatterSummary,
      { manifests: SCATTER_MANIFESTS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping['Customer Name']).toBe('[Superstore].[none:Customer Name:nk]');
      expect(result.fieldMapping.Region).toBe('[Superstore].[none:Region:nk]');
      expect(result.optionalFieldPrunes).toEqual([]);
      expect(
        result.warnings.some((warning) => warning.startsWith('Ambiguous categorical assignment:')),
      ).toBe(false);
    }
  });

  it('reserves a lone categorical field for the required scatter detail slot', () => {
    const scatterSummary: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({ name: 'Sales', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({ name: 'Profit', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({ name: 'Region', role: 'dimension', type: 'nominal', datatype: 'string' }),
      ],
    };

    const result = bindExplicitTemplate(
      'correlation-scatter-plot-chart',
      scatterSummary.fields.map((candidate) => candidate.column_ref),
      scatterSummary,
      { manifests: SCATTER_MANIFESTS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping.Region).toBe('[Superstore].[none:Region:nk]');
      expect(result.fieldMapping).not.toHaveProperty('Customer Name');
      expect(result.optionalFieldPrunes).toEqual([
        { templateField: 'Customer Name', derivation: 'none', role: ['nk', 'ok'] },
      ]);
    }
  });

  it('reserves a lone Customer Name field for the required scatter detail slot', () => {
    const scatterSummary: SchemaSummary = {
      datasource: 'Superstore',
      fields: [
        field({ name: 'Sales', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({ name: 'Profit', role: 'measure', type: 'quantitative', datatype: 'real' }),
        field({
          name: 'Customer Name',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
        }),
      ],
    };

    const result = bindExplicitTemplate(
      'correlation-scatter-plot-chart',
      scatterSummary.fields.map((candidate) => candidate.column_ref),
      scatterSummary,
      { manifests: SCATTER_MANIFESTS },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping.Region).toBe('[Superstore].[none:Customer Name:nk]');
      expect(result.fieldMapping).not.toHaveProperty('Customer Name');
      expect(result.optionalFieldPrunes).toEqual([
        { templateField: 'Customer Name', derivation: 'none', role: ['nk', 'ok'] },
      ]);
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
    } as unknown as RuntimeTemplateDescriptor;

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

  it('still resolves bare column-instance refs by discarding caller derivation', () => {
    const result = bindExplicitTemplate(
      'x-latlon',
      {
        Longitude: '[avg:Longitude:qk]',
        Latitude: '[sum:Latitude:qk]',
        Detail: '[none:City:nk]',
        Measure: '[avg:Sales:qk]',
      },
      SUMMARY,
      { manifests: manifests(LATLON) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fieldMapping.Longitude).toBe('[Superstore].[avg:Longitude:qk]');
      expect(result.fieldMapping.Latitude).toBe('[Superstore].[avg:Latitude:qk]');
      expect(result.fieldMapping.Measure).toBe('[Superstore].[sum:Sales:qk]');
    }
  });

  it('resolves datasource-qualified refs when datasource and field names contain dots or colons', () => {
    const dottedSummary: SchemaSummary = {
      datasource: 'Orders.Primary',
      fields: [
        field({
          name: 'Longitude',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'Orders.Primary',
        }),
        field({
          name: 'Latitude',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'Orders.Primary',
        }),
        field({
          name: 'City.Region',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'Orders.Primary',
        }),
        field({
          name: 'Profit:Ratio',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'Orders.Primary',
        }),
      ],
    };

    const result = bindExplicitTemplate(
      'x-latlon',
      {
        Longitude: '[Orders.Primary].[sum:Longitude:qk]',
        Latitude: '[Orders.Primary].[sum:Latitude:qk]',
        Detail: '[Orders.Primary].[none:City.Region:nk]',
        Measure: '[Orders.Primary].[sum:Profit:Ratio:qk]',
      },
      dottedSummary,
      { manifests: manifests(LATLON) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.datasource).toBe('Orders.Primary');
      expect(result.fieldMapping.Detail).toBe('[Orders.Primary].[none:City.Region:nk]');
      expect(result.fieldMapping.Measure).toBe('[Orders.Primary].[sum:Profit:Ratio:qk]');
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
