import { resolveLooseFieldReference } from './classify.js';
import type { SchemaField, SchemaSummary } from './schema-summary.js';

function field({ caption, columnName }: { caption?: string; columnName: string }): SchemaField {
  const bare = columnName.replace(/^\[|\]$/g, '');
  return {
    name: caption ?? bare,
    caption,
    columnName,
    role: 'measure',
    type: 'quantitative',
    datatype: 'real',
    datasource: 'Superstore',
    isAggregated: false,
    column_ref: `[Superstore].[sum:${bare}:qk]`,
  };
}

function summary(...fields: SchemaField[]): SchemaSummary {
  return { datasource: 'Superstore', fields };
}

describe('resolveLooseFieldReference', () => {
  it('resolves case-insensitive captions and bare column names', () => {
    const grossProfit = field({ caption: 'Gross Profit', columnName: '[gross_profit]' });
    const schema = summary(grossProfit);

    expect(resolveLooseFieldReference('gross profit', schema)).toEqual({
      kind: 'resolved',
      field: grossProfit,
    });
    expect(resolveLooseFieldReference('GROSS_PROFIT', schema)).toEqual({
      kind: 'resolved',
      field: grossProfit,
    });
  });

  it('resolves singular and plural field names', () => {
    const customer = field({ caption: 'Customer', columnName: '[Customer]' });

    expect(resolveLooseFieldReference('Customers', summary(customer))).toEqual({
      kind: 'resolved',
      field: customer,
    });
  });

  it('resolves one unambiguous business-synonym candidate', () => {
    const sales = field({ caption: 'Sales', columnName: '[sales_amount]' });

    expect(resolveLooseFieldReference('Revenue', summary(sales))).toEqual({
      kind: 'resolved',
      field: sales,
    });
  });

  it('returns every ambiguous business-synonym candidate in schema order', () => {
    const sales = field({ caption: 'Sales', columnName: '[Sales]' });
    const amount = field({ caption: 'Amount', columnName: '[Amount]' });

    expect(resolveLooseFieldReference('Revenue', summary(sales, amount))).toEqual({
      kind: 'ambiguous',
      candidates: [sales, amount],
    });
  });
});
