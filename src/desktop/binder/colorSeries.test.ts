import { readFileSync } from 'fs';
import { join } from 'path';

import { rewriteFieldReferences } from '../templates/fieldReferenceRewriter.js';
import { bindTemplate, classifyNoLlm, summarizeSchema } from './binder.js';
import { loadManifests } from './manifest.js';

const manifests = loadManifests();

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
): string =>
  `      <column name='[${name}]' role='${role}' type='${type}' datatype='${datatype}' />`;

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

const PRE_SERIES_SPLIT_TREND_TEMPLATE = `<workbook>
  <worksheets>
    <worksheet name='{{TITLE}}'>
  <table>
    <view>
      <datasources>
        <datasource name='{{DATASOURCE}}' />
      </datasources>
      <datasource-dependencies datasource='{{DATASOURCE}}'>
        <column datatype='date' name='[{{field_base_1}}]' role='dimension' type='ordinal' />
        <column datatype='real' name='[{{field_base_2}}]' role='measure' type='quantitative' />
        <column datatype='string' name='[{{field_base_3}}]' role='dimension' type='nominal' />
        <column-instance column='[{{field_base_2}}]' derivation='Sum' name='[sum:{{field_base_2}}:qk]' pivot='key' type='quantitative' />
        <column-instance column='[{{field_base_1}}]' derivation='Month-Trunc' name='[tmn:{{field_base_1}}:qk]' pivot='key' type='quantitative' />
      </datasource-dependencies>
      <aggregation value='true' />
    </view>
    <style>
      <style-rule element='axis'>
        <format attr='title' class='0' field='[{{DATASOURCE}}].[tmn:{{field_base_1}}:qk]' scope='cols' value='' />
        <format attr='subtitle' class='0' field='[{{DATASOURCE}}].[tmn:{{field_base_1}}:qk]' scope='cols' value='' />
        <format attr='auto-subtitle' class='0' field='[{{DATASOURCE}}].[tmn:{{field_base_1}}:qk]' scope='cols' value='true' />
      </style-rule>
    </style>
    <panes>
      <pane selection-relaxation-option='selection-relaxation-disallow'>
        <view>
          <breakdown value='auto' />
        </view>
        <mark class='Automatic' />
        <mark-sizing mark-sizing-setting='marks-scaling-off' />
        <style>
          <style-rule element='mark'>
            <format attr='size' value='1.3733149766921997' />
          </style-rule>
        </style>
      </pane>
    </panes>
    <rows>[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]</rows>
    <cols>[{{DATASOURCE}}].[tmn:{{field_base_1}}:qk]</cols>
  </table>
  <simple-id uuid='00000000-0000-0000-0000-000000000001' />
</worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='{{TITLE}}'>
  <viewpoint>
    <zoom type='entire-view' />
  </viewpoint>
  <simple-id uuid='00000000-0000-0000-0000-000000000002' />
</window>
  </windows>
</workbook>
`;

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

  it('renders an unbound color series byte-identically to the pre-series-split XML', () => {
    const manifest = manifests.get('trend-line-chart')!;
    expect(manifest.slots.some((slot) => slot.slot_id === 'color_series')).toBe(true);
    const currentTemplate = readFileSync(
      join(process.cwd(), 'src/desktop/data/templates/trend-line-chart.xml'),
      'utf-8',
    );
    const mapping = {
      '{{field_base_1}}': '[Active Users].[tmn:month:qk]',
      '{{field_base_2}}': '[Active Users].[sum:mau:qk]',
    };
    const rewrite = (template: string): string =>
      rewriteFieldReferences(template, mapping, 'Active Users', undefined, {
        templateSlots: manifest.slots,
      });

    const rendered = rewrite(currentTemplate);
    expect(rendered).not.toContain('<color');
    expect(rendered).toBe(rewrite(PRE_SERIES_SPLIT_TREND_TEMPLATE));
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
        column('Country', 'dimension', 'nominal', 'string'),
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
    });
  });
});
