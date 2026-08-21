import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BindingProposal, bindTemplate, summarizeSchema } from '../binder/binder.js';
import { buildInjectedWorkbookXml } from './injectTemplateCore.js';
import { createPuppetCompatibilityProjection } from './puppetCompatibilityProjection.js';
import {
  getRuntimeTemplateSnapshot,
  type RuntimeTemplateCatalogSnapshot,
  runtimeTemplateDescriptorFromSnapshot,
} from './runtimeTemplateCatalog.js';

const PL_WORKBOOK = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='PL'>
      <column name='[line_item]' role='dimension' type='nominal' datatype='string' />
      <column name='[amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[display_order]' role='measure' type='quantitative' datatype='integer' />
      <column name='[category]' role='dimension' type='nominal' datatype='string' />
    </datasource>
  </datasources>
</workbook>`;

let realRuntimeCatalog: Map<string, RuntimeTemplateCatalogSnapshot>;
let superstoreWorkbook: string;

const PROJECTION_PAIRS = [
  ['ranking-ordered-bar', 'ranking__ordered-bar__show-order-when-rank-matters-more-than-value'],
  [
    'part-to-whole-waterfall',
    'part-to-whole__waterfall__bridge-start-to-end-with-plus-minus-steps',
  ],
  ['correlation-scatter-plot-chart', 'correlation__scatter__relate-two-continuous-measures'],
  [
    'correlation-bubble-chart',
    'correlation__bubble-scatter__relate-two-measures-and-encode-a-third-by-size',
  ],
  [
    'part-to-whole-treemap-chart',
    'part-to-whole__treemap__show-hierarchical-sizes-in-nested-rectangles',
  ],
  ['spatial-choropleth-map', 'spatial__choropleth__map-rates-or-ratios-by-region'],
  ['trend-line-chart', 'change-over-time__line__default-time-series-trend'],
] as const;

function loadExactRuntimeCatalog(
  templates: readonly string[],
): Map<string, RuntimeTemplateCatalogSnapshot> {
  return new Map(
    templates.map((template) => {
      const snapshot = getRuntimeTemplateSnapshot(template, { includeExternal: false });
      if (snapshot === null) throw new Error(`Missing test template: ${template}`);
      return [
        template,
        { snapshot, descriptor: runtimeTemplateDescriptorFromSnapshot(snapshot) },
      ] as const;
    }),
  );
}

beforeAll(() => {
  realRuntimeCatalog = loadExactRuntimeCatalog([
    ...new Set(PROJECTION_PAIRS.flat()),
    'connected-scatterplot',
    'magnitude-paired-bar',
    'spatial-symbol-map',
  ]);
  superstoreWorkbook = readFileSync(
    join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
    'utf8',
  );
});

describe('createPuppetCompatibilityProjection', () => {
  it('filters automatic selection to canonical IDs without changing raw slot contracts', () => {
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);

    for (const [canonical, sibling] of PROJECTION_PAIRS) {
      const rawCanonical = realRuntimeCatalog.get(canonical)?.descriptor;
      const rawSibling = realRuntimeCatalog.get(sibling)?.descriptor;
      expect(projection.descriptors.has(canonical), canonical).toBe(true);
      expect(projection.descriptors.has(sibling), sibling).toBe(false);
      expect(projection.descriptors.get(canonical)?.slots).toEqual(rawCanonical?.slots);
      expect(projection.descriptors.get(canonical)?.calcs).toEqual(rawCanonical?.calcs);
      expect(projection.allDescriptors.get(canonical)).toBe(rawCanonical);
      expect(projection.allDescriptors.get(sibling)).toBe(rawSibling);
    }
    expect([...projection.descriptors.keys()].some((template) => template.includes('__'))).toBe(
      false,
    );
  });

  it('keeps the waterfall raw qualified slots and only adds a post-bind anchor mapping', async () => {
    const template = 'part-to-whole-waterfall';
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    const proposal: BindingProposal = {
      template,
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'field_base_1_sum', field: 'amount' },
        { slot_id: 'field_base_2', field: 'line_item' },
        { slot_id: 'field_base_1_none', field: 'amount' },
      ],
      confidence: 0.9,
    };

    expect(projection.descriptors.get(template)?.slots).toEqual(
      realRuntimeCatalog.get(template)?.descriptor.slots,
    );
    expect(projection.descriptors.get(template)?.slots).not.toContainEqual(
      expect.objectContaining({ slot_id: 'anchor_category' }),
    );

    const rawResult = await bindTemplate({
      ask: 'P&L waterfall from revenue to net income',
      workbookXml: PL_WORKBOOK,
      manifests: projection.allDescriptors,
      proposal,
    });
    expect(rawResult.status, JSON.stringify(rawResult)).toBe('bound');
    if (rawResult.status !== 'bound') return;
    expect(rawResult.args.field_mapping).toEqual({
      '{{field_base_1}}@sum': '[PL].[sum:amount:qk]',
      '{{field_base_2}}': '[PL].[none:line_item:nk]',
      '{{field_base_1}}@none': '[PL].[none:amount:qk]',
    });

    const result = projection.expandBinderResult(rawResult, summarizeSchema(PL_WORKBOOK));
    expect(result.status).toBe('bound');
    if (result.status === 'bound') {
      expect(result.args.field_mapping).toEqual({
        ...rawResult.args.field_mapping,
        'Anchor Category': '[PL].[none:category:nk]',
      });
      expect(result.warnings?.join(' ')).toContain('auto-bound anchor_category');
      const catalogValue = realRuntimeCatalog.get(template);
      expect(catalogValue).toBeDefined();
      if (!catalogValue) return;
      const injected = buildInjectedWorkbookXml({
        workbookXml: PL_WORKBOOK,
        templateXml: catalogValue.snapshot.xml,
        title: result.args.title,
        sheetType: result.args.sheet_type,
        templateParameters: result.args.template_parameters,
        fieldMapping: result.args.field_mapping,
        templateSlots: catalogValue.snapshot.descriptor.slots,
        optionalFieldPrunes: result.args.optional_field_prunes,
        applyNonce: 'waterfall-raw-slots',
      });
      expect(injected.ok).toBe(true);
      if (injected.ok) {
        expect(injected.xml).not.toMatch(/\{\{(?:DATASOURCE|field_base_[1-9]\d*)\}\}/);
      }
    }
  });

  it.each([
    {
      template: 'magnitude-paired-bar',
      ask: 'grouped bar chart of Sales by Category and Region',
      bindings: [
        { slot_id: 'field_base_1', field: 'Category' },
        { slot_id: 'field_base_2', field: 'Region' },
        { slot_id: 'field_base_3', field: 'Sales' },
      ],
      slots: [
        { slot_id: 'field_base_1', kind: 'categorical', derivation: 'none', role: ['rows'] },
        {
          slot_id: 'field_base_2',
          kind: 'categorical',
          derivation: 'none',
          role: ['rows', 'color'],
        },
        { slot_id: 'field_base_3', kind: 'quantitative', derivation: 'sum', role: ['cols'] },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Bar"');
        expect(xml).toContain(
          '<rows>([Sample - Superstore].[none:Category:nk] / [Sample - Superstore].[none:Region:nk])</rows>',
        );
        expect(xml).toContain('<cols>[Sample - Superstore].[sum:Sales:qk]</cols>');
        expect(xml).toContain('<color column="[Sample - Superstore].[none:Region:nk]"');
        expect(xml).not.toContain('<filter');
        expect(xml).not.toContain('<slices');
      },
    },
    {
      template: 'trend-line-chart',
      ask: 'line chart of Sales over Order Date by Category',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'Order Date' },
        { slot_id: 'field_base_3', field: 'Category' },
      ],
      slots: [
        { slot_id: 'field_base_1', kind: 'quantitative', derivation: 'sum', role: ['rows'] },
        { slot_id: 'field_base_2', kind: 'temporal', derivation: 'tmn', role: ['cols'] },
        { slot_id: 'field_base_3', kind: 'categorical', derivation: 'none', role: ['color'] },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Line"');
        expect(xml).toContain('<rows>[Sample - Superstore].[sum:Sales:qk]</rows>');
        expect(xml).toContain('<cols>[Sample - Superstore].[tmn:Order Date:qk]</cols>');
        expect(xml).toContain('<color column="[Sample - Superstore].[none:Category:nk]"');
      },
    },
    {
      template: 'correlation-scatter-plot-chart',
      ask: 'scatter plot of Sales vs Profit by Product Name',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'Profit' },
        { slot_id: 'field_base_3', field: 'Product Name' },
      ],
      slots: [
        { slot_id: 'field_base_1', kind: 'quantitative', derivation: 'sum', role: ['rows'] },
        { slot_id: 'field_base_2', kind: 'quantitative', derivation: 'sum', role: ['cols'] },
        { slot_id: 'field_base_3', kind: 'categorical', derivation: 'none', role: ['lod'] },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Circle"');
        expect(xml).toContain('<rows>[Sample - Superstore].[sum:Sales:qk]</rows>');
        expect(xml).toContain('<cols>[Sample - Superstore].[sum:Profit:qk]</cols>');
        expect(xml).toContain('<lod column="[Sample - Superstore].[none:Product Name:nk]"');
        expect(xml).not.toContain('<trendline');
        expect(xml).not.toContain('Profit Ratio');
        expect(xml).not.toContain('<color');
      },
    },
    {
      template: 'spatial-symbol-map',
      ask: 'symbol map of Sales by State/Province',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'State/Province' },
      ],
      slots: [
        { slot_id: 'field_base_1', kind: 'quantitative', derivation: 'sum', role: ['size'] },
        { slot_id: 'field_base_2', kind: 'geo', derivation: 'none', role: ['lod'] },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Circle"');
        expect(xml).toContain('<rows>[Sample - Superstore].[Latitude (generated)]</rows>');
        expect(xml).toContain('<cols>[Sample - Superstore].[Longitude (generated)]</cols>');
        expect(xml).toContain('<size column="[Sample - Superstore].[sum:Sales:qk]"');
        expect(xml).toContain('<lod column="[Sample - Superstore].[none:State/Province:nk]"');
        expect(xml).not.toContain('<color');
        expect(xml).not.toContain('<tooltip');
        expect(xml).not.toContain('Country/Region');
        expect(xml).not.toContain('<column name="[City]"');
      },
    },
  ])(
    'injects an explicit raw-slot $template bind without placeholder residue',
    async (testCase) => {
      const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
      const catalogValue = realRuntimeCatalog.get(testCase.template);
      expect(catalogValue).toBeDefined();
      if (!catalogValue) return;
      expect(catalogValue.descriptor.slots).toEqual(
        testCase.slots.map((slot) => expect.objectContaining({ ...slot, required: true })),
      );
      const result = await bindTemplate({
        ask: testCase.ask,
        workbookXml: superstoreWorkbook,
        manifests: projection.allDescriptors,
        proposal: {
          template: testCase.template,
          title: testCase.template,
          bindings: testCase.bindings,
          confidence: 0.9,
        },
      });

      expect(result.status, JSON.stringify(result)).toBe('bound');
      if (result.status !== 'bound') return;
      const injected = buildInjectedWorkbookXml({
        workbookXml: superstoreWorkbook,
        templateXml: catalogValue.snapshot.xml,
        title: result.args.title,
        sheetType: result.args.sheet_type,
        templateParameters: result.args.template_parameters,
        fieldMapping: result.args.field_mapping,
        templateSlots: catalogValue.snapshot.descriptor.slots,
        optionalFieldPrunes: result.args.optional_field_prunes,
        dateparseAxis: result.args.dateparse_axis,
        applyNonce: `${testCase.template}-raw-slots`,
      });

      expect(injected.ok).toBe(true);
      if (!injected.ok) return;
      expect(injected.xml).not.toMatch(/\{\{(?:DATASOURCE|field_base_[1-9]\d*)\}\}/);
      const worksheetXml = injected.xml.match(
        new RegExp(`<worksheet name="${testCase.template}">([\\s\\S]*?)</worksheet>`),
      )?.[0];
      expect(worksheetXml).toBeDefined();
      testCase.assertions(worksheetXml!);
    },
  );

  it('keeps an explicit three-slot scatter trendline carrier', () => {
    const snapshot = getRuntimeTemplateSnapshot('correlation-scatter-trendline-chart', {
      includeExternal: false,
    });

    expect(snapshot).not.toBeNull();
    if (!snapshot) return;
    expect(snapshot.descriptor.slots).toEqual([
      expect.objectContaining({
        slot_id: 'field_base_1',
        kind: 'quantitative',
        derivation: 'sum',
        role: ['rows'],
        required: true,
      }),
      expect.objectContaining({
        slot_id: 'field_base_2',
        kind: 'quantitative',
        derivation: 'sum',
        role: ['cols'],
        required: true,
      }),
      expect.objectContaining({
        slot_id: 'field_base_3',
        kind: 'categorical',
        derivation: 'none',
        role: ['lod'],
        required: true,
      }),
    ]);
    expect(snapshot.xml).toContain('<trendline');
    expect(snapshot.xml).toContain("enabled='true'");
    expect(snapshot.xml).toContain("fit='linear'");
  });

  it('uses semantic roles from a real runtime choropleth descriptor to bind neutral geo slots', async () => {
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    const descriptor = projection.descriptors.get('spatial-choropleth-map');
    expect(descriptor?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot_id: 'field_base_2',
          kind: 'geo',
          semantic_role: '[Country].[ISO3166_2]',
        }),
        expect.objectContaining({
          slot_id: 'field_base_3',
          kind: 'geo',
          semantic_role: '[State].[Name]',
        }),
      ]),
    );

    const result = await bindTemplate({
      ask: 'filled map of Profit by State/Province',
      workbookXml: superstoreWorkbook,
      manifests: projection.descriptors,
    });

    expect(result.status, JSON.stringify(result)).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.args.template_name).toBe('spatial-choropleth-map');
    expect(result.args.field_mapping).toMatchObject({
      '{{field_base_1}}': '[Sample - Superstore].[sum:Profit:qk]',
      '{{field_base_2}}': '[Sample - Superstore].[none:Country/Region:nk]',
      '{{field_base_3}}': '[Sample - Superstore].[none:State/Province:nk]',
    });
  });

  it.each([
    ['bar chart of Sales by Sub-Category', 'bound', 'ranking-ordered-bar'],
    ['waterfall of Profit by Sub-Category', 'propose', undefined],
    ['line chart of Sales by Order Date', 'propose', undefined],
    ['scatter plot of Profit and Sales by Sub-Category', 'bound', 'correlation-scatter-plot-chart'],
    ['filled map of Profit by State/Province', 'bound', 'spatial-choropleth-map'],
    ['symbol map of Sales by Country/Region, State/Province, and City', 'propose', undefined],
    ['connected scatterplot of Profit vs Sales by Customer Name and Region', 'propose', undefined],
  ])('reports the honest automatic outcome for %s', async (ask, status, template) => {
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    const result = await bindTemplate({
      ask,
      workbookXml: superstoreWorkbook,
      manifests: projection.descriptors,
    });

    expect(result.status).toBe(status);
    if (result.status === 'bound') expect(result.args.template_name).toBe(template);
  });
});
