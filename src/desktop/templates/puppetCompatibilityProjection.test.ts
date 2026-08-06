import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BindingProposal, bindTemplate, summarizeSchema } from '../binder/binder.js';
import { buildInjectedWorkbookXml } from './injectTemplateCore.js';
import { createPuppetCompatibilityProjection } from './puppetCompatibilityProjection.js';
import {
  loadRuntimeTemplateCatalogSnapshots,
  type RuntimeTemplateCatalogSnapshot,
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

beforeAll(() => {
  realRuntimeCatalog = loadRuntimeTemplateCatalogSnapshots();
  superstoreWorkbook = readFileSync(
    join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
    'utf8',
  );
});

describe('createPuppetCompatibilityProjection', () => {
  it('filters automatic selection to canonical IDs without changing raw slot contracts', () => {
    const pairs = [
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

    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);

    for (const [canonical, sibling] of pairs) {
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
      template: 'trend-line-chart',
      ask: 'line chart of Sales by Order Date colored by Sub-Category',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'Order Date' },
        { slot_id: 'field_base_3', field: 'Sub-Category' },
      ],
    },
    {
      template: 'spatial-symbol-map',
      ask: 'symbol map of Sales and Profit by Country, State, and City',
      bindings: [
        { slot_id: 'field_base_1', field: 'Sales' },
        { slot_id: 'field_base_2', field: 'Profit' },
        { slot_id: 'field_base_4', field: 'Country/Region' },
        { slot_id: 'field_base_5', field: 'State/Province' },
        { slot_id: 'field_base_6', field: 'City' },
      ],
    },
  ])(
    'injects an explicit raw-slot $template bind without placeholder residue',
    async (testCase) => {
      const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
      const catalogValue = realRuntimeCatalog.get(testCase.template);
      expect(catalogValue).toBeDefined();
      if (!catalogValue) return;
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
    },
  );

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
    ['scatter plot of Profit and Sales by Sub-Category', 'propose', undefined],
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
