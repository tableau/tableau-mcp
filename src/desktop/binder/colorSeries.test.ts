import { rewriteFieldReferences } from '../templates/fieldReferenceRewriter.js';
import { getRuntimeTemplateSnapshot } from '../templates/runtimeTemplateCatalog.js';
import { bindTemplate, classifyNoLlm, summarizeSchema } from './binder.js';
import type { Family, RuntimeTemplateDescriptor, SlotKind, SlotSpec } from './manifest-types.js';

function slot(
  slot_id: string,
  template_field: string,
  derivation: SlotSpec['derivation'],
  role: string[],
  kind: SlotKind,
  required = true,
): SlotSpec {
  return { slot_id, template_field, derivation, role, kind, bindable: true, required };
}

function descriptor(
  template: string,
  family: Family,
  intent_keywords: string[],
  slots: SlotSpec[],
): RuntimeTemplateDescriptor {
  return {
    template,
    family,
    fast_path_eligible: true,
    fast_path_blockers: [],
    intent_keywords,
    description: `${family} test descriptor`,
    slots,
    calcs: [],
  };
}

const trendLine = descriptor(
  'trend-line-chart',
  'time-series',
  ['line', 'trend', 'over-time', 'monthly', 'active-users', 'last-12-months', 'mau'],
  [
    {
      ...slot('order_date', '{{field_base_1}}', 'tmn', ['cols'], 'temporal'),
      temporal_from_string: true,
    },
    slot('sales', '{{field_base_2}}', 'sum', ['rows'], 'quantitative'),
    slot('facet_col', '{{field_base_3}}', 'none', ['cols'], 'categorical', false),
    slot('color_series', '{{field_base_4}}', 'none', ['color'], 'categorical', false),
  ],
);
const magnitudeBar = descriptor(
  'magnitude-simple-bar',
  'magnitude',
  ['magnitude', 'absolute'],
  [
    slot('category', 'Category', 'none', ['rows'], 'categorical'),
    slot('measure', 'Sales', 'sum', ['cols'], 'quantitative'),
  ],
);
const waterfall = descriptor(
  'part-to-whole-waterfall',
  'part-to-whole',
  ['waterfall', 'bridge'],
  [
    slot('profit', 'Profit', 'sum', ['rows'], 'quantitative'),
    slot('sub_category', 'Sub-Category', 'none', ['cols'], 'categorical'),
  ],
);
const symbolMap = descriptor(
  'spatial-symbol-map',
  'spatial',
  ['symbol-map', 'map'],
  [
    slot('country', 'Country/Region', 'none', ['lod'], 'geo'),
    slot('sales', 'Sales', 'sum', ['size'], 'quantitative'),
  ],
);
const manifests = new Map(
  [trendLine, magnitudeBar, waterfall, symbolMap].map((manifest) => [manifest.template, manifest]),
);

const workbookXml = (datasource: string, columns: string): string => `<?xml version='1.0'?>
<workbook>
  <datasources>
    <datasource name='${datasource}'>
${columns}
    </datasource>
  </datasources>
</workbook>`;

const column = (
  name: string,
  role: 'dimension' | 'measure',
  type: 'nominal' | 'ordinal' | 'quantitative',
  datatype: 'string' | 'date' | 'integer' | 'real',
  semanticRole?: string,
): string =>
  `      <column name='[${name}]' role='${role}' type='${type}' datatype='${datatype}'` +
  `${semanticRole ? ` semantic-role='${semanticRole}'` : ''} />`;

const activeUsersXml = (
  categoricals: string[] = ['product'],
  monthDatatype: 'string' | 'date' = 'string',
): string =>
  workbookXml(
    'Active Users',
    [
      column('month', 'dimension', monthDatatype === 'date' ? 'ordinal' : 'nominal', monthDatatype),
      ...categoricals.map((name) => column(name, 'dimension', 'nominal', 'string')),
      column('mau', 'measure', 'quantitative', 'integer'),
      column('dau', 'measure', 'quantitative', 'integer'),
      column('new_users', 'measure', 'quantitative', 'integer'),
      column('churned_users', 'measure', 'quantitative', 'integer'),
    ].join('\n'),
  );

describe('classifyNoLlm — e4 trend color series', () => {
  it('auto-colors monthly active users by the sole spare categorical', () => {
    const result = classifyNoLlm(
      'Show me monthly active users over the last 12 months.',
      manifests,
      summarizeSchema(activeUsersXml()),
    );

    expect(result).not.toBeNull();
    expect(result!.template).toBe('trend-line-chart');
    expect(result!.bindings).toEqual([
      { slot_id: 'order_date', field: 'month' },
      { slot_id: 'sales', field: 'mau' },
      { slot_id: 'color_series', field: 'product' },
    ]);
  });

  it('gives an explicit small-multiples facet precedence over color series', () => {
    const result = classifyNoLlm(
      'mau over time, small multiples by product',
      manifests,
      summarizeSchema(activeUsersXml(['product'], 'date')),
    );

    expect(result).not.toBeNull();
    expect(result!.template).toBe('trend-line-chart');
    expect(result!.bindings).toContainEqual({ slot_id: 'facet_col', field: 'product' });
    expect(result!.bindings.some((binding) => binding.slot_id === 'color_series')).toBe(false);
  });

  it('leaves color series unbound when no spare categorical remains', () => {
    const result = classifyNoLlm(
      'mau over time',
      manifests,
      summarizeSchema(activeUsersXml([], 'date')),
    );

    expect(result).not.toBeNull();
    expect(result!.bindings).toEqual([
      { slot_id: 'order_date', field: 'month' },
      { slot_id: 'sales', field: 'mau' },
    ]);
  });

  it('fails closed when two spare categoricals remain', () => {
    const result = classifyNoLlm(
      'mau over time',
      manifests,
      summarizeSchema(activeUsersXml(['product', 'region'], 'date')),
    );

    expect(result).not.toBeNull();
    expect(result!.bindings).toEqual([
      { slot_id: 'order_date', field: 'month' },
      { slot_id: 'sales', field: 'mau' },
    ]);
  });

  it('prunes an unbound color series from the runtime trend XML', () => {
    const snapshot = getRuntimeTemplateSnapshot('trend-line-chart')!;
    const colorSlot = snapshot.descriptor.slots.find((slot) => slot.role.includes('color'))!;
    const temporalSlot = snapshot.descriptor.slots.find((slot) => slot.kind === 'temporal')!;
    const measureSlot = snapshot.descriptor.slots.find(
      (slot) => slot.kind === 'quantitative' && slot.role.includes('rows'),
    )!;
    const templateSlots = snapshot.descriptor.slots.map((slot) =>
      slot === colorSlot ? { ...slot, required: false } : slot,
    );
    const rendered = rewriteFieldReferences(
      snapshot.xml,
      {
        [temporalSlot.template_field]: '[Active Users].[tmn:month:qk]',
        [measureSlot.template_field]: '[Active Users].[sum:mau:qk]',
      },
      'Active Users',
      undefined,
      { templateSlots },
    );

    expect(rendered).not.toContain('<color');
    expect(rendered).toContain('[Active Users].[tmn:month:qk]');
    expect(rendered).toContain('[Active Users].[sum:mau:qk]');
  });

  it('preserves e1, m1, s7, and a trend-line one-shot', async () => {
    const superstoreXml = workbookXml(
      'Superstore',
      [
        column('Region', 'dimension', 'nominal', 'string'),
        column('Sub-Category', 'dimension', 'nominal', 'string'),
        column('Sales', 'measure', 'quantitative', 'real'),
        column('Profit', 'measure', 'quantitative', 'real'),
      ].join('\n'),
    );
    const countryXml = workbookXml(
      'Football',
      [
        // semantic-role is required for the symbol map: it plots generated Lat/Long,
        // which Tableau materializes only for a geocoded field (gate 3c).
        column('Country', 'dimension', 'nominal', 'string', '[Country].[Name]'),
        column('Goals For', 'measure', 'quantitative', 'integer'),
      ].join('\n'),
    );
    const [e1, m1, s7] = await Promise.all([
      bindTemplate({ ask: 'Show me Sales by Region.', workbookXml: superstoreXml, manifests }),
      bindTemplate({
        ask: 'waterfall of Profit by Sub-Category',
        workbookXml: superstoreXml,
        manifests,
      }),
      bindTemplate({
        ask: 'symbol map of Goals For by Country',
        workbookXml: countryXml,
        manifests,
      }),
    ]);
    const trend = classifyNoLlm(
      'line chart of ARR by Renewal Date',
      manifests,
      summarizeSchema(
        workbookXml(
          'Revenue',
          [
            column('Renewal Date', 'dimension', 'ordinal', 'date'),
            column('ARR', 'measure', 'quantitative', 'real'),
          ].join('\n'),
        ),
      ),
    );

    expect([e1.status, m1.status, s7.status]).toEqual(['bound', 'bound', 'bound']);
    if (e1.status !== 'bound' || m1.status !== 'bound' || s7.status !== 'bound') {
      throw new Error('expected e1, m1, and s7 to remain bound');
    }
    expect([e1.args.template_name, m1.args.template_name, s7.args.template_name]).toEqual([
      'magnitude-simple-bar',
      'part-to-whole-waterfall',
      'spatial-symbol-map',
    ]);
    expect(trend).toEqual({
      template: 'trend-line-chart',
      bindings: [
        { slot_id: 'order_date', field: 'Renewal Date' },
        { slot_id: 'sales', field: 'ARR' },
      ],
      encodings: { filled: [], unfilled: [] },
    });
  });
});
