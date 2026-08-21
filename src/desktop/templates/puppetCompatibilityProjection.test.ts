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

const BULLET_WORKBOOK = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Bullet Data'>
      <column name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column name='[Sales]' role='measure' type='quantitative' datatype='real' />
      <column name='[Target]' role='measure' type='quantitative' datatype='real' />
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
    'correlation-highlight-table',
    'part-to-whole-pie-chart',
    'quota-attainment-bullet',
    'box-plot-chart',
    'gantt-task-rollup-chart',
    'distribution-histogram',
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
      const expectedCanonicalSlots =
        canonical === 'correlation-bubble-chart'
          ? rawCanonical?.slots.map((slot) =>
              slot.kind === 'quantitative' && slot.role.includes('size')
                ? { ...slot, required: true }
                : slot,
            )
          : rawCanonical?.slots;
      expect(projection.descriptors.has(canonical), canonical).toBe(true);
      expect(projection.descriptors.has(sibling), sibling).toBe(false);
      expect(projection.descriptors.get(canonical)?.slots).toEqual(expectedCanonicalSlots);
      expect(projection.descriptors.get(canonical)?.calcs).toEqual(rawCanonical?.calcs);
      if (canonical === 'correlation-bubble-chart') {
        expect(projection.allDescriptors.get(canonical)?.slots).toEqual(expectedCanonicalSlots);
      } else {
        expect(projection.allDescriptors.get(canonical)).toBe(rawCanonical);
      }
      expect(projection.allDescriptors.get(sibling)).toBe(rawSibling);
    }
    expect([...projection.descriptors.keys()].some((template) => template.includes('__'))).toBe(
      false,
    );
    expect(
      projection.allDescriptors
        .get('correlation-highlight-table')
        ?.slots.find((slot) => slot.role.includes('color'))?.required,
    ).toBe(true);
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
    {
      template: 'part-to-whole-treemap-chart',
      ask: 'treemap of Sales by Category and Sub-Category',
      bindings: [
        { slot_id: 'field_base_1', field: 'Category' },
        { slot_id: 'field_base_2', field: 'Sub-Category' },
        { slot_id: 'field_base_3', field: 'Sales' },
      ],
      slots: [
        {
          slot_id: 'field_base_1',
          kind: 'categorical',
          derivation: 'none',
          role: ['lod', 'text'],
        },
        {
          slot_id: 'field_base_2',
          kind: 'categorical',
          derivation: 'none',
          role: ['lod', 'text'],
        },
        {
          slot_id: 'field_base_3',
          kind: 'quantitative',
          derivation: 'sum',
          role: ['size', 'tooltip'],
        },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Square"');
        expect(xml).toContain('<lod column="[Sample - Superstore].[none:Category:nk]"');
        expect(xml).toContain('<text column="[Sample - Superstore].[none:Category:nk]"');
        expect(xml).toContain('<lod column="[Sample - Superstore].[none:Sub-Category:nk]"');
        expect(xml).toContain('<text column="[Sample - Superstore].[none:Sub-Category:nk]"');
        expect(xml).toContain('<size column="[Sample - Superstore].[sum:Sales:qk]"');
        expect(xml).toContain('<tooltip column="[Sample - Superstore].[sum:Sales:qk]"');
        expect(xml).not.toContain('Customer Name');
        expect(xml).not.toContain('Product Name');
        expect(xml).not.toContain('Profit');
      },
    },
    {
      template: 'correlation-highlight-table',
      ask: 'heatmap of Sales by Category and Region',
      bindings: [
        { slot_id: 'field_base_1', field: 'Category' },
        { slot_id: 'field_base_2', field: 'Region' },
        { slot_id: 'field_base_3', field: 'Sales' },
      ],
      slots: [
        { slot_id: 'field_base_1', kind: 'categorical', derivation: 'none', role: ['rows'] },
        { slot_id: 'field_base_2', kind: 'categorical', derivation: 'none', role: ['cols'] },
        {
          slot_id: 'field_base_3',
          kind: 'quantitative',
          derivation: 'sum',
          role: ['color', 'text', 'tooltip'],
          required: true,
        },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Square"');
        expect(xml).toContain('<rows>[Sample - Superstore].[none:Category:nk]</rows>');
        expect(xml).toContain('<cols>[Sample - Superstore].[none:Region:nk]</cols>');
        expect(xml).toContain('<color column="[Sample - Superstore].[sum:Sales:qk]"');
        expect(xml).toContain(
          '<encoding attr="color" field="[Sample - Superstore].[sum:Sales:qk]"',
        );
        expect(xml).not.toContain('Calculation_1368249927221915648');
        expect(xml).not.toContain('Order Date');
        expect(xml).not.toContain('<filter');
        expect(xml).not.toContain('<slices');
      },
    },
    {
      template: 'part-to-whole-pie-chart',
      ask: 'pie chart of Sales by Region',
      bindings: [
        { slot_id: 'field_base_1', field: 'Region' },
        { slot_id: 'field_base_2', field: 'Sales' },
      ],
      slots: [
        {
          slot_id: 'field_base_1',
          kind: 'categorical',
          derivation: 'none',
          role: ['color', 'text'],
        },
        {
          slot_id: 'field_base_2',
          kind: 'quantitative',
          derivation: 'sum',
          role: ['wedge-size', 'tooltip', 'text'],
        },
      ],
      assertions: (xml: string) => {
        expect(xml).toContain('<mark class="Pie"');
        expect(xml).toContain('<color column="[Sample - Superstore].[none:Region:nk]"');
        expect(xml).toContain('<text column="[Sample - Superstore].[none:Region:nk]"');
        expect(xml).toContain('<wedge-size column="[Sample - Superstore].[sum:Sales:qk]"');
        expect(xml).toContain('<tooltip column="[Sample - Superstore].[sum:Sales:qk]"');
        expect(xml).toContain(
          '<column-instance column="[Sales]" derivation="Sum" name="[pcto:sum:Sales:qk]"',
        );
        expect(xml).toContain('<table-calc ordering-type="Table" type="PctTotal"');
        expect(xml).toContain('<text column="[Sample - Superstore].[pcto:sum:Sales:qk]"');
        expect(xml).toContain('value="p0.0%"');
        expect(xml).not.toContain('Customer Name');
        expect(xml).not.toContain('Profit');
      },
    },
  ])(
    'injects an explicit raw-slot $template bind without placeholder residue',
    async (testCase) => {
      const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
      const catalogValue = realRuntimeCatalog.get(testCase.template);
      expect(catalogValue).toBeDefined();
      if (!catalogValue) return;
      expect(projection.allDescriptors.get(testCase.template)?.slots).toEqual(
        testCase.slots.map((slot) =>
          expect.objectContaining({
            ...slot,
            required: 'required' in slot ? slot.required : true,
          }),
        ),
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

  it('injects a bullet with an actual bar and explicit target reference marker', async () => {
    const template = 'quota-attainment-bullet';
    const catalogValue = realRuntimeCatalog.get(template);
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    expect(catalogValue).toBeDefined();
    if (!catalogValue) return;
    expect(projection.allDescriptors.get(template)?.slots).toEqual([
      expect.objectContaining({
        slot_id: 'field_base_1',
        kind: 'categorical',
        derivation: 'none',
        role: ['rows'],
        required: true,
      }),
      expect.objectContaining({
        slot_id: 'field_base_2',
        kind: 'quantitative',
        derivation: 'sum',
        role: ['cols', 'tooltip', 'reference-line'],
        required: true,
      }),
      expect.objectContaining({
        slot_id: 'field_base_3',
        kind: 'quantitative',
        derivation: 'sum',
        role: ['tooltip', 'reference-line'],
        required: true,
      }),
    ]);
    expect(projection.descriptors.get(template)?.slots).toEqual(
      projection.allDescriptors.get(template)?.slots,
    );

    const result = await bindTemplate({
      ask: 'bullet chart of Sales vs Target by Region',
      workbookXml: BULLET_WORKBOOK,
      manifests: projection.allDescriptors,
      proposal: {
        template,
        title: template,
        bindings: [
          { slot_id: 'field_base_1', field: 'Region' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_3', field: 'Target' },
        ],
        confidence: 0.9,
      },
    });
    expect(result.status, JSON.stringify(result)).toBe('bound');
    if (result.status !== 'bound') return;
    const injected = buildInjectedWorkbookXml({
      workbookXml: BULLET_WORKBOOK,
      templateXml: catalogValue.snapshot.xml,
      title: result.args.title,
      sheetType: result.args.sheet_type,
      templateParameters: result.args.template_parameters,
      fieldMapping: result.args.field_mapping,
      templateSlots: catalogValue.snapshot.descriptor.slots,
      optionalFieldPrunes: result.args.optional_field_prunes,
      applyNonce: 'quota-attainment-bullet-actual-target',
    });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    const worksheetXml = injected.xml.match(
      /<worksheet name="quota-attainment-bullet">([\s\S]*?)<\/worksheet>/,
    )?.[0];
    expect(worksheetXml).toBeDefined();
    expect(worksheetXml).toContain('<mark class="Bar"');
    expect(worksheetXml).toContain('<rows>[Bullet Data].[none:Region:nk]</rows>');
    expect(worksheetXml).toContain('<cols>[Bullet Data].[sum:Sales:qk]</cols>');
    expect(worksheetXml).not.toContain('<lod column="[Bullet Data].[sum:Target:qk]"');
    expect(worksheetXml).toContain('<tooltip column="[Bullet Data].[sum:Target:qk]"');
    expect(worksheetXml).toContain('axis-column="[Bullet Data].[sum:Sales:qk]"');
    expect(worksheetXml).toContain('value-column="[Bullet Data].[sum:Target:qk]"');
    expect(worksheetXml).not.toMatch(/\{\{(?:DATASOURCE|field_base_[1-9]\d*)\}\}/);
  });

  it('keeps the native box analytic while binding a distinct record-grain detail', async () => {
    const template = 'box-plot-chart';
    const catalogValue = realRuntimeCatalog.get(template)!;
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    const result = await bindTemplate({
      ask: 'box plot of Sales by Category with Order ID detail',
      workbookXml: superstoreWorkbook,
      manifests: projection.allDescriptors,
      proposal: {
        template,
        title: template,
        bindings: [
          { slot_id: 'field_base_1', field: 'Sales' },
          { slot_id: 'field_base_2', field: 'Category' },
          { slot_id: 'field_base_3', field: 'Order ID' },
        ],
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
      applyNonce: 'advanced-box',
    });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    expect(injected.xml).toContain('<rows>[Sample - Superstore].[sum:Sales:qk]</rows>');
    expect(injected.xml).toContain('<cols>[Sample - Superstore].[none:Category:nk]</cols>');
    expect(injected.xml).toContain('<lod column="[Sample - Superstore].[none:Order ID:nk]"');
    expect(injected.xml).toContain('boxplot-whisker-type="standard"');
    expect(injected.xml).toContain('boxplot-mark-exclusion="false"');
  });

  it('keeps the quantitative axis title visible on the canonical ordered bar', async () => {
    const template = 'ranking-ordered-bar';
    const catalogValue = realRuntimeCatalog.get(template)!;
    const result = await bindTemplate({
      ask: 'bar chart of Sales by Category',
      workbookXml: superstoreWorkbook,
      manifests: createPuppetCompatibilityProjection(realRuntimeCatalog).allDescriptors,
      proposal: {
        template,
        title: template,
        bindings: [
          { slot_id: 'field_base_1', field: 'Category' },
          { slot_id: 'field_base_2', field: 'Sales' },
        ],
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
      applyNonce: 'ordered-bar-visible-axis-title',
    });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    expect(injected.xml).not.toMatch(/attr="title"[^>]*value=""/);
  });

  it('injects a task-level gantt span without multiplying duration across duplicate task rows', async () => {
    const template = 'gantt-task-rollup-chart';
    const catalogValue = realRuntimeCatalog.get(template)!;
    const result = await bindTemplate({
      ask: 'gantt chart of Order ID from Order Date to Ship Date',
      workbookXml: superstoreWorkbook,
      manifests: createPuppetCompatibilityProjection(realRuntimeCatalog).allDescriptors,
      proposal: {
        template,
        title: template,
        bindings: [
          { slot_id: 'field_base_1', field: 'Order ID' },
          { slot_id: 'field_base_2_min', field: 'Order Date' },
          { slot_id: 'field_base_2_none', field: 'Order Date' },
          { slot_id: 'field_base_3', field: 'Ship Date' },
        ],
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
      applyNonce: 'advanced-gantt-task-span',
    });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    const worksheetXml = injected.xml.match(
      /<worksheet name="gantt-task-rollup-chart">([\s\S]*?)<\/worksheet>/,
    )?.[0];
    expect(worksheetXml).toBeDefined();
    expect(worksheetXml).toContain('<mark class="GanttBar"');
    expect(worksheetXml).toContain('<rows>[Sample - Superstore].[none:Order ID:nk]</rows>');
    expect(worksheetXml).toContain('<cols>[Sample - Superstore].[min:Order Date:qk]</cols>');
    expect(worksheetXml).toContain(
      'formula="{ FIXED [Order ID] : DATEDIFF(&apos;day&apos;, MIN([Order Date]), MAX([Ship Date])) }"',
    );
    expect(worksheetXml).toMatch(
      /<size column="\[Sample - Superstore\]\.\[min:Calculation_[^\]]+:qk\]"/,
    );
    expect(worksheetXml).not.toMatch(/sum:Calculation_[^\]]+:qk/);
  });

  it('overrides only the histogram bin size while one measure fills both raw slots', async () => {
    const template = 'distribution-histogram';
    const catalogValue = realRuntimeCatalog.get(template)!;
    const result = await bindTemplate({
      ask: 'histogram of Sales',
      workbookXml: superstoreWorkbook,
      manifests: createPuppetCompatibilityProjection(realRuntimeCatalog).allDescriptors,
      proposal: {
        template,
        title: template,
        bindings: [
          { slot_id: 'field_base_1_cnt', field: 'Sales' },
          { slot_id: 'field_base_1_none', field: 'Sales' },
        ],
        confidence: 0.9,
        bin_size: 250,
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
      applyNonce: 'advanced-histogram',
      histogramBinSize: result.args.bin_size,
    });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    const worksheetXml = injected.xml.match(
      /<worksheet name="distribution-histogram">([\s\S]*?)<\/worksheet>/,
    )?.[0];
    expect(worksheetXml).toBeDefined();
    expect(worksheetXml).toContain(
      '<calculation class="bin" decimals="2" formula="[Sales]" peg="0" size="250"',
    );
    expect(worksheetXml).toContain('<rows>[Sample - Superstore].[cnt:Sales:qk]</rows>');
    expect(worksheetXml).toMatch(
      /<cols>\[Sample - Superstore\]\.\[none:Profit \(bin\)_tpl_[^:\]]+:qk\]<\/cols>/,
    );
    expect(worksheetXml).not.toContain('formula="[Profit]"');

    const authoredDefault = buildInjectedWorkbookXml({
      workbookXml: superstoreWorkbook,
      templateXml: catalogValue.snapshot.xml,
      title: result.args.title,
      sheetType: result.args.sheet_type,
      templateParameters: result.args.template_parameters,
      fieldMapping: result.args.field_mapping,
      templateSlots: catalogValue.snapshot.descriptor.slots,
      applyNonce: 'advanced-histogram-default',
    });
    expect(authoredDefault.ok).toBe(true);
    if (authoredDefault.ok) {
      const defaultWorksheetXml = authoredDefault.xml.match(
        /<worksheet name="distribution-histogram">([\s\S]*?)<\/worksheet>/,
      )?.[0];
      expect(defaultWorksheetXml).toContain(
        '<calculation class="bin" decimals="2" formula="[Sales]" peg="0" size="500"',
      );
    }
  });

  it('injects the authored waterfall running total, contribution sign, and final total', async () => {
    const template = 'part-to-whole-waterfall';
    const catalogValue = realRuntimeCatalog.get(template)!;
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    const raw = await bindTemplate({
      ask: 'waterfall of amount by line_item',
      workbookXml: PL_WORKBOOK,
      manifests: projection.allDescriptors,
      proposal: {
        template,
        title: template,
        bindings: [
          { slot_id: 'field_base_1_sum', field: 'amount' },
          { slot_id: 'field_base_2', field: 'line_item' },
          { slot_id: 'field_base_1_none', field: 'amount' },
        ],
        confidence: 0.9,
      },
    });
    expect(raw.status, JSON.stringify(raw)).toBe('bound');
    if (raw.status !== 'bound') return;
    const result = projection.expandBinderResult(raw, summarizeSchema(PL_WORKBOOK));
    if (result.status !== 'bound') return;
    const injected = buildInjectedWorkbookXml({
      workbookXml: PL_WORKBOOK,
      templateXml: catalogValue.snapshot.xml,
      title: result.args.title,
      sheetType: result.args.sheet_type,
      templateParameters: result.args.template_parameters,
      fieldMapping: result.args.field_mapping,
      templateSlots: catalogValue.snapshot.descriptor.slots,
      applyNonce: 'advanced-waterfall',
    });
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    expect(injected.xml).toContain('type="CumTotal"');
    expect(injected.xml).toContain('formula="-[amount]"');
    expect(injected.xml).toContain('formula="SUM([amount])&gt;0"');
    expect(injected.xml).toMatch(/<color column="\[PL\]\.\[usr:Calculation_[^\]]+:nk\]"/);
    expect(injected.xml).toMatch(/<size column="\[PL\]\.\[sum:Calculation_[^\]]+:qk\]"/);
    expect(injected.xml).toContain('<cols total="true">[PL].[none:line_item:nk]</cols>');
    expect(injected.xml).not.toContain(
      'attr="display" field="[PL].[none:line_item:nk]" value="false"',
    );
    expect(injected.xml).not.toContain('attr="total-label"');
    expect(injected.xml).not.toContain('Net Profit');
  });

  it('adds ATTR color only for an explicitly colored bubble ask', async () => {
    const template = 'correlation-bubble-chart';
    const catalogValue = realRuntimeCatalog.get(template)!;
    const projection = createPuppetCompatibilityProjection(realRuntimeCatalog);
    const colored = await bindTemplate({
      ask: 'bubble chart of Sales versus Profit by Product Name sized by Quantity colored by Category',
      workbookXml: superstoreWorkbook,
      manifests: projection.allDescriptors,
      proposal: {
        template,
        title: 'colored bubble',
        bindings: [
          { slot_id: 'field_base_1', field: 'Profit' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_3', field: 'Quantity' },
          { slot_id: 'field_base_4', field: 'Product Name' },
          { slot_id: 'field_base_5', field: 'Category' },
        ],
        confidence: 0.9,
      },
    });
    expect(colored.status, JSON.stringify(colored)).toBe('bound');
    if (colored.status !== 'bound') return;
    const coloredXml = buildInjectedWorkbookXml({
      workbookXml: superstoreWorkbook,
      templateXml: catalogValue.snapshot.xml,
      title: colored.args.title,
      sheetType: colored.args.sheet_type,
      templateParameters: colored.args.template_parameters,
      fieldMapping: colored.args.field_mapping,
      templateSlots: catalogValue.snapshot.descriptor.slots,
      optionalFieldPrunes: colored.args.optional_field_prunes,
      applyNonce: 'advanced-bubble-color',
    });
    expect(coloredXml.ok).toBe(true);
    if (!coloredXml.ok) return;
    expect(coloredXml.xml).toContain('<color column="[Sample - Superstore].[attr:Category:nk]"');

    const uncolored = await bindTemplate({
      ask: 'bubble chart of Sales versus Profit by Product Name sized by Quantity',
      workbookXml: superstoreWorkbook,
      manifests: projection.allDescriptors,
      proposal: {
        template,
        title: 'plain bubble',
        bindings: [
          { slot_id: 'field_base_1', field: 'Profit' },
          { slot_id: 'field_base_2', field: 'Sales' },
          { slot_id: 'field_base_3', field: 'Quantity' },
          { slot_id: 'field_base_4', field: 'Product Name' },
        ],
        confidence: 0.9,
      },
    });
    expect(uncolored.status, JSON.stringify(uncolored)).toBe('bound');
    if (uncolored.status !== 'bound') return;
    expect(uncolored.args.field_mapping).not.toHaveProperty('{{field_base_5}}');
    const plainXml = buildInjectedWorkbookXml({
      workbookXml: superstoreWorkbook,
      templateXml: catalogValue.snapshot.xml,
      title: uncolored.args.title,
      sheetType: uncolored.args.sheet_type,
      templateParameters: uncolored.args.template_parameters,
      fieldMapping: uncolored.args.field_mapping,
      templateSlots: catalogValue.snapshot.descriptor.slots,
      optionalFieldPrunes: uncolored.args.optional_field_prunes,
      applyNonce: 'advanced-bubble-plain',
    });
    expect(plainXml.ok).toBe(true);
    if (plainXml.ok) expect(plainXml.xml).not.toContain('<color column=');
  });

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
