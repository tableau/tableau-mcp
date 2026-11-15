import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

import { createPuppetCompatibilityProjection } from '../templates/puppetCompatibilityProjection.js';
import { loadRuntimeTemplateCatalogSnapshots } from '../templates/runtimeTemplateCatalog.js';
import { bindTemplate } from './binder.js';
import type { RuntimeTemplateDescriptor } from './manifest-types.js';

const SUPERSTORE = fs.readFileSync(
  path.join(process.cwd(), 'src', 'desktop', 'binder', 'fixtures', 'superstore-scratch-ref.xml'),
  'utf8',
);

const oneDateSchema = (dims: string[]): string =>
  `<workbook><datasources><datasource name='Metrics'>
${dims.map((d) => `<column name='[${d}]' role='dimension' type='nominal' datatype='string' />`).join('\n')}
<column name='[ARR]' role='measure' type='quantitative' datatype='integer' />
<column name='[Close Date]' role='dimension' type='ordinal' datatype='date' />
</datasource></datasources></workbook>`;

let manifests: Map<string, RuntimeTemplateDescriptor>;

beforeAll(() => {
  manifests = createPuppetCompatibilityProjection(
    loadRuntimeTemplateCatalogSnapshots({ automaticOnly: true, includeExternal: false }),
  ).descriptors;
});

type BindOutcome =
  | { status: 'propose' | 'escalate' }
  | {
      status: 'bound';
      template: string;
      mapping: Record<string, string>;
      fields: string[];
      top_n: unknown;
    };

async function bind(ask: string, workbookXml: string = SUPERSTORE): Promise<BindOutcome> {
  const result = await bindTemplate({ ask, workbookXml, manifests });
  if (result.status !== 'bound') return { status: result.status } as BindOutcome;
  const mapping = result.args.field_mapping as Record<string, string>;
  return {
    status: 'bound',
    template: result.args.template_name,
    mapping,
    fields: Object.keys(mapping).filter((key) => /^\{\{field_base_\d+\}\}$/.test(key)),
    top_n: result.args.top_n,
  };
}

describe('plain line chart color series is optional', () => {
  it('binds the verbatim audit ask with exactly the measure and the date', async () => {
    const result = await bind(
      'Create a line chart of Sales over time by continuous month of Order Date',
    );
    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.template).toBe('trend-line-chart');
    expect(result.mapping).toEqual({
      '{{field_base_1}}': '[Sample - Superstore].[sum:Sales:qk]',
      '{{field_base_2}}': '[Sample - Superstore].[tmn:Order Date:qk]',
    });
  });

  it.each([
    ['line chart of Sales over Order Date', 'Order Date'],
    ['line chart of Sales by Order Date', 'Order Date'],
    ['line chart of monthly Sales over Order Date', 'Order Date'],
    ['line chart of Sales over Ship Date', 'Ship Date'],
  ])('binds %s colorless with exactly two fields', async (ask, date) => {
    const result = await bind(ask);
    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.template).toBe('trend-line-chart');
    expect(result.mapping).toEqual({
      '{{field_base_1}}': '[Sample - Superstore].[sum:Sales:qk]',
      '{{field_base_2}}': `[Sample - Superstore].[tmn:${date}:qk]`,
    });
  });

  it.each([
    [
      'Create a line chart of Sales over time by continuous month of Order Date. Show one line per Category',
      'Category',
    ],
    ['line chart of Sales over Order Date by Category', 'Category'],
    ['line chart of Sales over Order Date per Segment', 'Segment'],
    ['line chart of Sales over Order Date colored by Ship Mode', 'Ship Mode'],
    ['line chart of Sales over Order Date by Customer Name', 'Customer Name'],
    ['line chart of Sales over Order Date, top 5 Sub-Category', 'Sub-Category'],
  ])('binds %s with the named field on color', async (ask, series) => {
    const result = await bind(ask);
    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.template).toBe('trend-line-chart');
    expect(result.mapping['{{field_base_3}}']).toBe(`[Sample - Superstore].[none:${series}:nk]`);
    expect(result.fields).toHaveLength(3);
  });

  it('keeps the top-5 constraint on the named-series line', async () => {
    const result = await bind('line chart of Sales over Order Date, top 5 Sub-Category');
    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.top_n).toBe(5);
  });

  it.each([
    ['line chart of Sales over Order Date by Category and Region'],
    ['line chart of Sales and Profit over Order Date'],
    ['line chart of Sales by year of Order Date'],
    ['line chart of Sales by quarter of Order Date'],
    ['line chart of Sales by week of Order Date'],
    ['line chart of yearly Sales over Order Date'],
    ['line chart of Sales over Order Date in 2024'],
    ['line chart of Sales over Order Date excluding Furniture'],
    ['line chart of Sales over Order Date for Furniture'],
    ['line chart of Sales over Order Date YTD'],
    ['line chart of Sales over Order Date Q1'],
    ['line chart of Sales over Order Date West'],
    ['line chart of Sales over Order Date with a trend line'],
    ['line chart of Sales % of total over Order Date'],
    ['line chart of Sales % change over Order Date'],
    ['line chart of Sales (% of total) over Order Date'],
    ['line chart of Sales + Profit over Order Date'],
    ['line chart of Sales / Quantity over Order Date'],
    ['line chart of Sales & Profit over Order Date'],
    ['line chart of Sales over Order Date trend line'],
    ['line chart of Sales over Order Date, trend line'],
    ['line chart of Sales over Order Date + trend line'],
    ['trend line of Sales over Order Date'],
    ['line chart of Sales over Order Date with trendlines'],
    ['line chart of the change of Sales over Order Date'],
    ['line chart of Sales over Order Date by Sub-Category and Category'],
    ['line chart of Sales over Order Date by Sub-Category, Category'],
  ])('proposes instead of dropping part of: %s', async (ask) => {
    expect((await bind(ask)).status).toBe('propose');
  });

  it.each([['trend of ARR by Product'], ['monthly ARR trend by Product']])(
    'keeps %s bound with Product on color on a one-date schema',
    async (ask) => {
      const result = await bind(ask, oneDateSchema(['Product', 'Region']));
      expect(result.status).toBe('bound');
      if (result.status !== 'bound') return;
      expect(result.template).toBe('trend-line-chart');
      expect(result.fields).toHaveLength(3);
      expect(result.mapping['{{field_base_3}}']).toContain('Product');
    },
  );

  it.each([
    ['line chart of ARR over Close Date'],
    ['line chart of ARR over time'],
    ['Create a line chart of ARR over time by continuous month of Close Date'],
  ])('does not add an unasked Product series to: %s', async (ask) => {
    const result = await bind(ask, oneDateSchema(['Product']));
    expect(result.status).toBe('bound');
    if (result.status !== 'bound') return;
    expect(result.fields).toHaveLength(2);
    expect(JSON.stringify(result.mapping)).not.toContain('Product');
  });

  it.each([
    ['line chart of Sales over Order Date by Product Line and Product'],
    ['line chart of Sales over Order Date by Product Line, Product'],
  ])('proposes when a short field name is also named separately: %s', async (ask) => {
    const schema = oneDateSchema(['Product Line', 'Product']).replace('ARR', 'Sales');
    expect((await bind(ask, schema.replace('Close Date', 'Order Date'))).status).toBe('propose');
  });
});
