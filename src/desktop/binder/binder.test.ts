import { beforeAll, describe, expect, it } from 'vitest';

import { createPuppetCompatibilityProjection } from '../templates/puppetCompatibilityProjection.js';
import { loadRuntimeTemplateCatalogSnapshots } from '../templates/runtimeTemplateCatalog.js';
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
import type { Family, RuntimeTemplateDescriptor } from './manifest-types.js';

const WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Sub-Category]' role='dimension' type='nominal' datatype='string' />
      <column name='[Customer Name]' role='dimension' type='nominal' datatype='string' />
      <column name='[Order ID]' role='dimension' type='nominal' datatype='string' />
      <column name='[Country/Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[State/Province]' role='dimension' type='nominal' datatype='string' />
      <column name='[City]' role='dimension' type='nominal' datatype='string' />
      <column name='[Order Date]' role='dimension' type='ordinal' datatype='date' />
      <column name='[Ship Date]' role='dimension' type='ordinal' datatype='date' />
      <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
      <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
      <column name='[Quantity]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;

const GRAIN_AMBIGUOUS_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='teams+'>
      <column caption='Goals' datatype='integer' name='[goals]' role='measure' type='quantitative' />
      <column caption='Goals For' datatype='integer' name='[goals_for]' role='measure' type='quantitative' />
      <connection>
        <metadata-records>
          <metadata-record class='column'>
            <local-name>[goals]</local-name>
            <parent-name>[players.csv]</parent-name>
          </metadata-record>
          <metadata-record class='column'>
            <local-name>[goals_for]</local-name>
            <parent-name>[standings.csv]</parent-name>
          </metadata-record>
        </metadata-records>
      </connection>
    </datasource>
  </datasources>
</workbook>`;

const KPI_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook><datasources><datasource name='Bets'>
  <column name='[O/U Line]' role='measure' type='quantitative' datatype='real' />
</datasource></datasources></workbook>`;

const METRICS_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook><datasources><datasource name='Metrics'>
  <column name='[Product]' role='dimension' type='nominal' datatype='string' />
  <column name='[ARR]' role='measure' type='quantitative' datatype='integer' />
  <column name='[Close Date]' role='dimension' type='ordinal' datatype='date' />
</datasource></datasources></workbook>`;

let descriptors: Map<string, RuntimeTemplateDescriptor>;
let allDescriptors: Map<string, RuntimeTemplateDescriptor>;

beforeAll(() => {
  const projection = createPuppetCompatibilityProjection(
    loadRuntimeTemplateCatalogSnapshots({ automaticOnly: true, includeExternal: false }),
  );
  descriptors = projection.descriptors;
  allDescriptors = projection.allDescriptors;
});

function workbookWithApproxCount(field: string, count: number): string {
  return WORKBOOK_XML.replace(
    '</datasource>',
    `<connection><metadata-records><metadata-record class='column'><local-name>[${field}]</local-name><approx-count>${count}</approx-count></metadata-record></metadata-records></connection></datasource>`,
  );
}

function pieProposal(field = 'Region'): BindingProposal {
  return {
    template: 'part-to-whole-pie-chart',
    title: `Sales by ${field}`,
    bindings: [
      { slot_id: 'field_base_1', field },
      { slot_id: 'field_base_2', field: 'Sales' },
    ],
    confidence: 0.9,
  };
}

it('rejects a plain-pie proposal for an explicit donut ask', async () => {
  const result = await bindTemplate({
    ask: 'donut chart of Sales by Region',
    workbookXml: WORKBOOK_XML,
    manifests: allDescriptors,
    proposal: pieProposal(),
  });

  expect(result.status).toBe('escalate');
  if (result.status !== 'escalate') return;
  expect(result.blockers[0].detail).toContain('distinct live-proven donor');
});

function rankingProposal(title = 'Sales by Region'): BindingProposal {
  return {
    template: 'ranking-ordered-bar',
    title,
    bindings: [
      { slot_id: 'field_base_1', field: 'Region' },
      { slot_id: 'field_base_2', field: 'Sales' },
    ],
    confidence: 0.9,
  };
}

function scatterProposal(): BindingProposal {
  return {
    template: 'correlation-scatter-plot-chart',
    title: 'Profit vs Sales',
    bindings: [
      { slot_id: 'field_base_1', field: 'Sales' },
      { slot_id: 'field_base_2', field: 'Profit' },
      { slot_id: 'field_base_3', field: 'Customer Name' },
    ],
    confidence: 0.9,
  };
}

it('binds explicit Insights bar and line proposals through the non-discovery catalog', async () => {
  expect(allDescriptors.has('insights__bar_chart')).toBe(false);
  expect(allDescriptors.has('insights__line_chart')).toBe(false);
  const insightsProjection = createPuppetCompatibilityProjection(
    loadRuntimeTemplateCatalogSnapshots({
      automaticOnly: true,
      includeExternal: false,
      additionalTemplates: ['insights__bar_chart', 'insights__line_chart'],
    }),
  );
  const cases: Array<{
    ask: string;
    proposal: BindingProposal;
    expectedMapping: Record<string, string>;
  }> = [
    {
      ask: 'bar chart of ARR by Product filtered by Close Date',
      proposal: {
        template: 'insights__bar_chart',
        title: 'ARR by Product',
        bindings: [
          { slot_id: 'field_base_1', field: 'Product' },
          { slot_id: 'field_base_2', field: 'ARR' },
          { slot_id: 'field_base_3', field: 'Close Date' },
        ],
        confidence: 1,
      },
      expectedMapping: {
        '{{field_base_1}}': '[Metrics].[none:Product:nk]',
        '{{field_base_2}}': '[Metrics].[sum:ARR:qk]',
        '{{field_base_3}}': '[Metrics].[none:Close Date:qk]',
      },
    },
    {
      ask: 'line chart of ARR over Close Date',
      proposal: {
        template: 'insights__line_chart',
        title: 'ARR over time',
        bindings: [
          { slot_id: 'field_base_1', field: 'ARR' },
          { slot_id: 'field_base_2_tdy', field: 'Close Date' },
          { slot_id: 'field_base_2_none', field: 'Close Date' },
        ],
        confidence: 1,
      },
      expectedMapping: {
        '{{field_base_1}}': '[Metrics].[sum:ARR:qk]',
        '{{field_base_2}}@tdy': '[Metrics].[tdy:Close Date:qk]',
        '{{field_base_2}}@none': '[Metrics].[none:Close Date:qk]',
      },
    },
  ];

  for (const { ask, proposal, expectedMapping } of cases) {
    expect(insightsProjection.descriptors.has(proposal.template)).toBe(false);
    expect(insightsProjection.allDescriptors.has(proposal.template)).toBe(true);
    const result = await bindTemplate({
      ask,
      workbookXml: METRICS_WORKBOOK_XML,
      manifests: insightsProjection.allDescriptors,
      proposal,
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') continue;
    expect(result.args.template_name).toBe(proposal.template);
    expect(result.args.field_mapping).toEqual(expectedMapping);
  }
});

describe('binder/schema-summary', () => {
  it('summarizes fields and chooses the primary datasource', () => {
    const summary = summarizeSchema(WORKBOOK_XML);

    expect(summary.datasource).toBe('Superstore');
    expect(summary.fields.find((field) => field.name === 'Sales')?.role).toBe('measure');
    expect(summary.fields.find((field) => field.name === 'Region')?.role).toBe('dimension');
  });

  it('preserves federated parent-table identity', () => {
    const summary = summarizeSchema(GRAIN_AMBIGUOUS_WORKBOOK_XML);

    expect(summary.fields.find((field) => field.name === 'Goals')?.table).toBe('[players.csv]');
    expect(summary.fields.find((field) => field.name === 'Goals For')?.table).toBe(
      '[standings.csv]',
    );
  });
});

describe('binder/classifyNoLlm', () => {
  it('classifies a clear bar ask with runtime slot ids', () => {
    expect(
      classifyNoLlm('bar chart of Sales by Region', descriptors, summarizeSchema(WORKBOOK_XML)),
    ).toEqual(
      expect.objectContaining({
        template: 'ranking-ordered-bar',
        bindings: [
          { slot_id: 'field_base_1', field: 'Region' },
          { slot_id: 'field_base_2', field: 'Sales' },
        ],
      }),
    );
  });

  it('classifies a distinct column ask without confusing the bar twin', () => {
    expect(
      classifyNoLlm('column chart of Sales by Region', descriptors, summarizeSchema(WORKBOOK_XML)),
    ).toEqual(
      expect.objectContaining({
        template: 'ranking-ordered-column',
        bindings: [
          { slot_id: 'field_base_1', field: 'Sales' },
          { slot_id: 'field_base_2', field: 'Region' },
        ],
      }),
    );
  });

  it('classifies a stacked bar with all required runtime slots', () => {
    const result = classifyNoLlm(
      'stacked bar of Sales by Region and Category',
      descriptors,
      summarizeSchema(WORKBOOK_XML),
    );

    expect(result?.template).toBe('part-to-whole-stacked-bar-chart');
    expect(result?.bindings).toEqual(
      expect.arrayContaining([
        { slot_id: 'field_base_1', field: expect.any(String) },
        { slot_id: 'field_base_2', field: 'Sales' },
        { slot_id: 'field_base_3', field: expect.any(String) },
      ]),
    );
  });

  it('fails closed when the ask has no chart intent', () => {
    expect(classifyNoLlm('hello there', descriptors, summarizeSchema(WORKBOOK_XML))).toBeNull();
  });

  it('keeps the unproven task-level gantt span off the no-LLM path', () => {
    expect(
      classifyNoLlm(
        'gantt chart of Order ID from Order Date to Ship Date',
        descriptors,
        summarizeSchema(WORKBOOK_XML),
      ),
    ).toBeNull();
  });
});

describe('binder/bindTemplate — two-call protocol', () => {
  it('binds a clear bar ask on Call 1 with raw runtime mappings', async () => {
    const result = await bindTemplate({
      ask: 'bar chart of Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.used_llm).toBe(false);
    expect(result.args.template_name).toBe('ranking-ordered-bar');
    expect(result.args.template_parameters.DATASOURCE).toBe('Superstore');
    expect(result.args.field_mapping).toEqual({
      '{{field_base_1}}': '[Superstore].[none:Region:nk]',
      '{{field_base_2}}': '[Superstore].[sum:Sales:qk]',
    });
    expect(result.apply_hint).toBe('worksheet-path');
  });

  it('binds the column twin with its transposed runtime slots', async () => {
    const result = await bindTemplate({
      ask: 'column chart of Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.template_name).toBe('ranking-ordered-column');
    expect(result.args.field_mapping).toEqual({
      '{{field_base_1}}': '[Superstore].[sum:Sales:qk]',
      '{{field_base_2}}': '[Superstore].[none:Region:nk]',
    });
  });

  it('returns a raw-slot scatter proposal when deterministic binding declines', async () => {
    const result = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
    });

    expect(result.status).toBe('propose');
    if (result.status !== 'propose') return;
    const scatter = result.llm_input.candidate_templates.find(
      (candidate) => candidate.template === 'correlation-scatter-plot-chart',
    );
    expect(scatter?.slots.map((slot) => slot.slot_id)).toEqual([
      'field_base_1',
      'field_base_2',
      'field_base_3',
    ]);
    expect(scatter?.slots.every((slot) => slot.kind !== 'calc')).toBe(true);
    expect(result.output_schema).toBe(PROPOSAL_OUTPUT_SCHEMA);
  });

  it('exposes only bindable runtime slots for every proposal candidate', async () => {
    const result = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
    });

    expect(result.status).toBe('propose');
    if (result.status !== 'propose') return;
    for (const candidate of result.llm_input.candidate_templates) {
      const descriptor = descriptors.get(candidate.template)!;
      expect(candidate.slots.map((slot) => slot.slot_id)).toEqual(
        descriptor.slots.filter((slot) => slot.bindable).map((slot) => slot.slot_id),
      );
    }
  });

  it('validates a complete raw-slot scatter proposal on Call 2', async () => {
    const result = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal: scatterProposal(),
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.used_llm).toBe(true);
    expect(result.args.field_mapping).toEqual({
      '{{field_base_1}}': '[Superstore].[sum:Sales:qk]',
      '{{field_base_2}}': '[Superstore].[sum:Profit:qk]',
      '{{field_base_3}}': '[Superstore].[none:Customer Name:nk]',
    });
  });

  it('rejects a raw proposal missing a required slot', async () => {
    const proposal = scatterProposal();
    proposal.bindings.pop();
    const result = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal,
    });

    expect(result.status).toBe('escalate');
    if (result.status === 'escalate') expect(result.reason).toBe('missing-required-slot');
  });

  it('rejects a raw Call-2 heatmap proposal that omits its color measure', async () => {
    const result = await bindTemplate({
      ask: 'heatmap of Sales by Category and Region',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'correlation-highlight-table',
        title: 'Sales heatmap',
        bindings: [
          { slot_id: 'field_base_1', field: 'Category' },
          { slot_id: 'field_base_2', field: 'Region' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status === 'escalate') expect(result.reason).toBe('missing-required-slot');
  });

  it('rejects a raw Call-2 bullet proposal that reuses the actual as its target', async () => {
    const result = await bindTemplate({
      ask: 'bullet chart of Sales vs Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'quota-attainment-bullet',
        title: 'Sales vs target',
        bindings: [
          { slot_id: 'field_base_1', field: 'Region' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_3', field: 'Sales' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.reason).toBe('base-column-conflict');
    expect(result.blockers[0].detail).toContain('distinct underlying fields');
  });

  it('rejects a raw Call-2 bullet proposal that omits the target marker field', async () => {
    const result = await bindTemplate({
      ask: 'bullet chart of Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'quota-attainment-bullet',
        title: 'Sales bullet',
        bindings: [
          { slot_id: 'field_base_1', field: 'Region' },
          { slot_id: 'field_base_2', field: 'Sales' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.reason).toBe('missing-required-slot');
    expect(result.blockers[0].detail).toContain('reference-line');
  });

  it('rejects a high-cardinality pie proposal on Call 2', async () => {
    const result = await bindTemplate({
      ask: 'pie chart of Sales by Region',
      workbookXml: workbookWithApproxCount('Region', 13),
      manifests: allDescriptors,
      proposal: pieProposal(),
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.reason).toBe('kind-mismatch');
    expect(result.blockers[0].detail).toContain('13 distinct values');
    expect(result.blockers[0].detail).toContain('workable maximum of 12');
  });

  it('rejects a Call-2 box plot that reuses its category as record grain', async () => {
    const result = await bindTemplate({
      ask: 'box plot of Sales by Category with Category detail',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'box-plot-chart',
        title: 'Sales box plot',
        bindings: [
          { slot_id: 'field_base_1', field: 'Sales' },
          { slot_id: 'field_base_2', field: 'Category' },
          { slot_id: 'field_base_3', field: 'Category' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.blockers[0].detail).toContain('three distinct underlying fields');
  });

  it('rejects a Call-2 box grain that differs from the explicit detail clause', async () => {
    const result = await bindTemplate({
      ask: 'box plot of Sales by Category with Customer Name detail',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'box-plot-chart',
        title: 'Sales box plot',
        bindings: [
          { slot_id: 'field_base_1', field: 'Sales' },
          { slot_id: 'field_base_2', field: 'Category' },
          { slot_id: 'field_base_3', field: 'Region' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.blockers[0].detail).toContain('record grain "Customer Name"');
    expect(result.blockers[0].detail).toContain('record grain "Region"');
  });

  it('rejects a Call-2 box category remap and accepts the exact required roles', async () => {
    const proposal: BindingProposal = {
      template: 'box-plot-chart',
      title: 'Sales box plot',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'Customer Name' },
        { slot_id: 'field_base_3', field: 'Order ID' },
      ],
      confidence: 0.9,
    };
    const remapped = await bindTemplate({
      ask: 'box plot of Sales by Category with Order ID detail',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal,
    });
    expect(remapped.status).toBe('escalate');
    if (remapped.status === 'escalate') {
      expect(remapped.blockers[0].detail).toContain('category "Category"');
    }

    const exact = await bindTemplate({
      ask: 'box plot of Sales by Category with Order ID detail',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        ...proposal,
        bindings: proposal.bindings.map((binding) =>
          binding.slot_id === 'field_base_2' ? { ...binding, field: 'Category' } : binding,
        ),
      },
    });
    expect(exact.status).toBe('bound');
  });

  it.each(['box plot', 'boxplot', 'box-plot', 'box-and-whisker'])(
    'accepts exact required roles for the %s prefix on Call 2',
    async (prefix) => {
      const result = await bindTemplate({
        ask: `${prefix} of Sales by Category with Order ID detail`,
        workbookXml: WORKBOOK_XML,
        manifests: allDescriptors,
        proposal: {
          template: 'box-plot-chart',
          title: 'Sales box plot',
          bindings: [
            { slot_id: 'field_base_1', field: 'Sales' },
            { slot_id: 'field_base_2', field: 'Category' },
            { slot_id: 'field_base_3', field: 'Order ID' },
          ],
          confidence: 0.9,
        },
      });

      expect(result.status).toBe('bound');
    },
  );

  it('rejects a Call-2 gantt proposal that swaps explicit start and end dates', async () => {
    const result = await bindTemplate({
      ask: 'gantt chart of Customer Name from Order Date to Ship Date',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'gantt-task-rollup-chart',
        title: 'Order gantt',
        bindings: [
          { slot_id: 'field_base_1', field: 'Customer Name' },
          { slot_id: 'field_base_2_min', field: 'Ship Date' },
          { slot_id: 'field_base_2_none', field: 'Ship Date' },
          { slot_id: 'field_base_3', field: 'Order Date' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.blockers[0].detail).toContain('start field "Order Date"');
    expect(result.blockers[0].detail).toContain('end field "Ship Date"');
  });

  it('rejects swapped gantt dates before a trailing color modifier', async () => {
    const result = await bindTemplate({
      ask: 'gantt chart of Customer Name from Order Date to Ship Date, colored by Category',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'gantt-task-rollup-chart',
        title: 'Order gantt',
        bindings: [
          { slot_id: 'field_base_1', field: 'Customer Name' },
          { slot_id: 'field_base_2_min', field: 'Ship Date' },
          { slot_id: 'field_base_2_none', field: 'Ship Date' },
          { slot_id: 'field_base_3', field: 'Order Date' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.blockers[0].detail).toContain('start field "Order Date"');
    expect(result.blockers[0].detail).toContain('end field "Ship Date"');
  });

  it('rejects a Call-2 gantt task remap and keeps exact roles blocked until live proof', async () => {
    const proposal: BindingProposal = {
      template: 'gantt-task-rollup-chart',
      title: 'Order gantt',
      bindings: [
        { slot_id: 'field_base_1', field: 'Category' },
        { slot_id: 'field_base_2_min', field: 'Order Date' },
        { slot_id: 'field_base_2_none', field: 'Order Date' },
        { slot_id: 'field_base_3', field: 'Ship Date' },
      ],
      confidence: 0.9,
    };
    const remapped = await bindTemplate({
      ask: 'gantt chart of Customer Name from Order Date to Ship Date',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal,
    });
    expect(remapped.status).toBe('escalate');
    if (remapped.status === 'escalate') {
      expect(remapped.blockers[0].detail).toContain('task "Customer Name"');
    }

    const exact = await bindTemplate({
      ask: 'gantt chart of Customer Name from Order Date to Ship Date',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        ...proposal,
        bindings: proposal.bindings.map((binding) =>
          binding.slot_id === 'field_base_1' ? { ...binding, field: 'Customer Name' } : binding,
        ),
      },
    });
    expect(exact.status).toBe('escalate');
    if (exact.status !== 'escalate') return;
    expect(exact.blockers).toContainEqual({
      code: 'kind-mismatch',
      detail: expect.stringContaining('not-live-proven'),
    });
  });

  it('binds one histogram measure to both authored bin and raw-count slots', async () => {
    const result = await bindTemplate({
      ask: 'histogram of Sales',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'distribution-histogram',
        title: 'Sales histogram',
        bindings: [
          { slot_id: 'field_base_1_cnt', field: 'Sales' },
          { slot_id: 'field_base_1_none', field: 'Sales' },
        ],
        confidence: 0.9,
        bin_size: 250,
      },
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.bin_size).toBe(250);
  });

  it('rejects histogram proposals with distinct bin/count fields or invalid bin sizes', async () => {
    const base: BindingProposal = {
      template: 'distribution-histogram',
      title: 'Histogram',
      bindings: [
        { slot_id: 'field_base_1_cnt', field: 'Sales' },
        { slot_id: 'field_base_1_none', field: 'Profit' },
      ],
      confidence: 0.9,
    };
    const distinct = await bindTemplate({
      ask: 'histogram of Sales',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: base,
    });
    const invalid = await bindTemplate({
      ask: 'histogram of Sales',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        ...base,
        bindings: base.bindings.map((binding) => ({ ...binding, field: 'Sales' })),
        bin_size: 0,
      },
    });

    expect(distinct.status).toBe('escalate');
    if (distinct.status === 'escalate') {
      expect(distinct.blockers[0].detail).toContain('same underlying measure');
    }
    expect(invalid.status).toBe('escalate');
    if (invalid.status === 'escalate') expect(invalid.blockers[0].detail).toContain('bin_size');
  });

  it('rejects a Call-2 bubble proposal that omits the required size measure', async () => {
    const result = await bindTemplate({
      ask: 'bubble chart of Sales versus Profit by Customer Name',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'correlation-bubble-chart',
        title: 'Bubble chart',
        bindings: [
          { slot_id: 'field_base_1', field: 'Profit' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_4', field: 'Customer Name' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status === 'escalate') expect(result.reason).toBe('missing-required-slot');
  });

  it('rejects an optional bubble color that the ask did not explicitly request', async () => {
    const result = await bindTemplate({
      ask: 'bubble chart of Sales versus Profit by Customer Name sized by Quantity',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'correlation-bubble-chart',
        title: 'Bubble chart',
        bindings: [
          { slot_id: 'field_base_1', field: 'Profit' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_3', field: 'Quantity' },
          { slot_id: 'field_base_4', field: 'Customer Name' },
          { slot_id: 'field_base_5', field: 'Category' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.blockers[0].detail).toContain('explicit color-by clause');
  });

  it('rejects Call-2 bubble role remaps and accepts the exact required roles', async () => {
    const proposal: BindingProposal = {
      template: 'correlation-bubble-chart',
      title: 'Bubble chart',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'Quantity' },
        { slot_id: 'field_base_3', field: 'Profit' },
        { slot_id: 'field_base_4', field: 'Category' },
      ],
      confidence: 0.9,
    };
    const remapped = await bindTemplate({
      ask: 'bubble chart of Sales versus Profit by Customer Name sized by Quantity',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal,
    });
    expect(remapped.status).toBe('escalate');
    if (remapped.status === 'escalate') {
      expect(remapped.blockers[0].detail).toContain('X "Sales"');
      expect(remapped.blockers[0].detail).toContain('Y "Profit"');
      expect(remapped.blockers[0].detail).toContain('size "Quantity"');
      expect(remapped.blockers[0].detail).toContain('grain "Customer Name"');
    }

    const exact = await bindTemplate({
      ask: 'bubble chart of Sales versus Profit by Customer Name sized by Quantity',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        ...proposal,
        bindings: [
          { slot_id: 'field_base_1', field: 'Profit' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_3', field: 'Quantity' },
          { slot_id: 'field_base_4', field: 'Customer Name' },
        ],
      },
    });
    expect(exact.status).toBe('bound');
  });

  it('rejects a Call-2 histogram measure remap and accepts the named measure', async () => {
    const proposal: BindingProposal = {
      template: 'distribution-histogram',
      title: 'Histogram',
      bindings: [
        { slot_id: 'field_base_1_cnt', field: 'Profit' },
        { slot_id: 'field_base_1_none', field: 'Profit' },
      ],
      confidence: 0.9,
    };
    const remapped = await bindTemplate({
      ask: 'histogram of Sales',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal,
    });
    expect(remapped.status).toBe('escalate');
    if (remapped.status === 'escalate') {
      expect(remapped.blockers[0].detail).toContain('measure "Sales"');
    }

    const exact = await bindTemplate({
      ask: 'histogram of Sales',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        ...proposal,
        bindings: proposal.bindings.map((binding) => ({ ...binding, field: 'Sales' })),
      },
    });
    expect(exact.status).toBe('bound');
  });

  it('keeps histogram measure validation across distribution and bin-size suffixes', async () => {
    const distribution = await bindTemplate({
      ask: 'histogram of Sales distribution',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
    });
    expect(distribution.status).toBe('bound');
    if (distribution.status === 'bound') {
      expect(distribution.args.field_mapping).toEqual({
        '{{field_base_1}}@cnt': '[Superstore].[cnt:Sales:qk]',
        '{{field_base_1}}@none': '[Superstore].[none:Sales:qk]',
      });
    }

    const sized = await bindTemplate({
      ask: 'histogram of Sales with bin size 250',
      workbookXml: WORKBOOK_XML,
      manifests: allDescriptors,
      proposal: {
        template: 'distribution-histogram',
        title: 'Histogram',
        bindings: [
          { slot_id: 'field_base_1_cnt', field: 'Sales' },
          { slot_id: 'field_base_1_none', field: 'Sales' },
        ],
        confidence: 0.9,
        bin_size: 250,
      },
    });
    expect(sized.status).toBe('bound');
    if (sized.status === 'bound') expect(sized.args.bin_size).toBe(250);
  });

  it('binds a waterfall proposal with derivation-qualified runtime keys', async () => {
    const result = await bindTemplate({
      ask: 'waterfall of Profit by Sub-Category',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal: {
        template: 'part-to-whole-waterfall',
        title: 'Profit waterfall',
        bindings: [
          { slot_id: 'field_base_1_sum', field: 'Profit' },
          { slot_id: 'field_base_2', field: 'Sub-Category' },
          { slot_id: 'field_base_1_none', field: 'Profit' },
        ],
        confidence: 0.9,
      },
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.field_mapping).toEqual({
      '{{field_base_1}}@sum': '[Superstore].[sum:Profit:qk]',
      '{{field_base_2}}': '[Superstore].[none:Sub-Category:nk]',
      '{{field_base_1}}@none': '[Superstore].[none:Profit:qk]',
    });
  });

  it('rejects an unordered waterfall when more than one sequence field exists', async () => {
    const workbookXml = WORKBOOK_XML.replace(
      '</datasource>',
      "<column name='[display_order]' role='measure' type='quantitative' datatype='integer' /><column name='[sort_order]' role='measure' type='quantitative' datatype='integer' /></datasource>",
    );
    const proposal: BindingProposal = {
      template: 'part-to-whole-waterfall',
      title: 'Profit waterfall',
      bindings: [
        { slot_id: 'field_base_1_sum', field: 'Profit' },
        { slot_id: 'field_base_2', field: 'Sub-Category' },
        { slot_id: 'field_base_1_none', field: 'Profit' },
      ],
      confidence: 0.9,
    };
    const result = await bindTemplate({
      ask: 'waterfall of Profit by Sub-Category',
      workbookXml,
      manifests: descriptors,
      proposal,
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.blockers[0].detail).toContain('multiple order fields');
    expect(result.blockers[0].detail).toContain('proposal.sort');

    const explicit = await bindTemplate({
      ask: 'waterfall of Profit by Sub-Category ordered by display_order',
      workbookXml,
      manifests: descriptors,
      proposal: { ...proposal, sort: { by: 'display_order', direction: 'asc' } },
    });
    expect(explicit.status).toBe('bound');
    if (explicit.status === 'bound') {
      expect(explicit.args.sort).toEqual({ by: 'display_order', direction: 'asc' });
    }
  });

  it('escalates unknown templates and low-confidence valid proposals', async () => {
    const unknown = await bindTemplate({
      ask: 'x',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal: { template: 'does-not-exist', title: 'x', bindings: [] },
    });
    const lowConfidence = await bindTemplate({
      ask: 'bar of Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal: { ...rankingProposal(), confidence: 0.1 },
    });

    expect(unknown.status).toBe('escalate');
    if (unknown.status === 'escalate') expect(unknown.reason).toBe('template-not-found');
    expect(lowConfidence.status).toBe('escalate');
    if (lowConfidence.status === 'escalate') expect(lowConfidence.reason).toBe('low-confidence');
  });

  it('threads sort and top_n through a validated raw proposal', async () => {
    const result = await bindTemplate({
      ask: 'top 10 regions by Sales',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal: {
        ...rankingProposal('Top Sales by Region'),
        sort: { by: 'Sales', direction: 'desc' },
        top_n: 10,
      },
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.sort).toEqual({ by: 'Sales', direction: 'desc' });
    expect(result.args.top_n).toBe(10);
  });
});

describe('binder/proposal contract', () => {
  it('keeps raw slot purpose in the model input', () => {
    const input = buildLlmInput(
      'bar chart of Sales by Region',
      descriptors,
      summarizeSchema(WORKBOOK_XML),
    );
    const candidate = input.candidate_templates.find(
      (item) => item.template === 'ranking-ordered-bar',
    );

    expect(candidate?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot_id: 'field_base_1', purpose: expect.any(String) }),
        expect.objectContaining({ slot_id: 'field_base_2', purpose: expect.any(String) }),
      ]),
    );
  });

  it('seeds every matching family before enforcing the five-candidate soft cap', () => {
    const families: Family[] = [
      'time-series',
      'ranking',
      'part-to-whole',
      'correlation',
      'distribution',
      'spatial',
    ];
    const synthetic = new Map<string, RuntimeTemplateDescriptor>(
      families.map((family, index) => {
        const template = `shared-${index}`;
        return [
          template,
          {
            template,
            family,
            fast_path_eligible: true,
            fast_path_blockers: [],
            intent_keywords: ['shared'],
            description: `${family} candidate`,
            slots: [],
            calcs: [],
          },
        ];
      }),
    );

    const input = buildLlmInput('shared', synthetic, { datasource: '', fields: [] });
    expect(input.candidate_templates.map((candidate) => candidate.template)).toHaveLength(6);
  });

  it('uses a closed proposal schema with a constrained derivation override', () => {
    expect(PROPOSAL_OUTPUT_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['template', 'title', 'bindings', 'confidence'],
    });
    const bindings = (PROPOSAL_OUTPUT_SCHEMA.properties as Record<string, any>).bindings;
    expect(bindings.items.properties.derivation.enum).toContain('sum');
    expect(bindings.items.properties.derivation.description).toMatch(/ONLY|only/i);
    expect((PROPOSAL_OUTPUT_SCHEMA.properties as Record<string, any>).bin_size).toEqual({
      type: 'number',
      exclusiveMinimum: 0,
    });
  });
});

describe('binder/title safety', () => {
  it('escapes a hostile proposal title at the substitution seam', async () => {
    const result = await bindTemplate({
      ask: 'bar of Sales by Region',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      proposal: rankingProposal("x'/><datasource name='pwn2"),
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.title).toBe('x&apos;/&gt;&lt;datasource name=&apos;pwn2');
  });

  it('strips XML-illegal control characters from a Call-1 title', async () => {
    const result = await bindTemplate({
      ask: 'bar chart of Sales by Region\u0000\u001B',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.title).toBe('bar chart of Sales by Region');
    expect(TITLE_CONTROL_CHAR_RE.test(result.args.title)).toBe(false);
  });
});

describe('binder/schema width cap', () => {
  function wideWorkbookXml(count: number): string {
    let columns = '';
    for (let index = 0; index < count; index += 1) {
      columns += `<column name='[F${index}]' role='measure' type='quantitative' datatype='real' />`;
    }
    return `<workbook><datasources><datasource name='Big'>${columns}</datasource></datasources></workbook>`;
  }

  function syntheticSummary(count: number): SchemaSummary {
    return {
      datasource: 'Big',
      fields: Array.from({ length: count }, (_, index) => ({
        name: `F${index}`,
        columnName: `[F${index}]`,
        role: 'measure' as const,
        type: 'quantitative',
        datatype: 'real',
        datasource: 'Big',
        isAggregated: false,
        column_ref: `[Big].[sum:F${index}:qk]`,
      })),
    };
  }

  it('escalates before classification above the field cap', async () => {
    const count = MAX_CLASSIFIABLE_FIELDS + 1;
    const result = await bindTemplate({
      ask: 'bar chart of F0 by F1',
      workbookXml: wideWorkbookXml(count),
      manifests: descriptors,
    });

    expect(result.status).toBe('escalate');
    if (result.status !== 'escalate') return;
    expect(result.reason).toBe('schema-too-large');
    expect(result.blockers[0].detail).toBe(
      `schema-too-large: ${count} fields > ${MAX_CLASSIFIABLE_FIELDS} cap`,
    );
  });

  it('fails closed in the classifier above the field cap', () => {
    expect(
      classifyNoLlm(
        'bar chart of F0 by F1',
        descriptors,
        syntheticSummary(MAX_CLASSIFIABLE_FIELDS + 1),
      ),
    ).toBeNull();
  });
});

describe('binder/KPI derivation and injected proposal seam', () => {
  it('uses an explicit average override for a bare-measure KPI', async () => {
    const result = await bindTemplate({
      ask: 'average O/U Line as a KPI',
      workbookXml: KPI_WORKBOOK_XML,
      manifests: descriptors,
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.template_name).toBe('kpi-text');
    expect(result.args.field_mapping).toEqual({
      '{{field_base_1}}': '[Bets].[avg:O/U Line:qk]',
    });
  });

  it('closes a Call-1 miss through an injected raw-slot proposal', async () => {
    const result = await bindTemplate({
      ask: 'scatter of Profit vs Sales',
      workbookXml: WORKBOOK_XML,
      manifests: descriptors,
      llmPropose: (input) => {
        expect(input.candidate_templates.length).toBeGreaterThan(0);
        return Promise.resolve(scatterProposal());
      },
    });

    expect(result.status).toBe('bound');
    if (result.status === 'bound') expect(result.used_llm).toBe(true);
  });

  it('rejects an injected-LLM pie proposal above the shared slice boundary', async () => {
    const result = await bindTemplate({
      ask: 'pie chart of Sales by Region',
      workbookXml: workbookWithApproxCount('Region', 13),
      manifests: descriptors,
      llmPropose: () => Promise.resolve(pieProposal()),
    });

    expect(result.status).toBe('escalate');
    if (result.status === 'escalate') expect(result.reason).toBe('kind-mismatch');
  });
});
