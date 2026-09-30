import { classifyNoLlm, resolveLooseFieldReference } from '../../metadata/binder/classify.js';
import type { RuntimeTemplateDescriptor } from '../../metadata/binder/manifest-types.js';
import type { SchemaField, SchemaSummary } from '../../metadata/binder/schema-summary.js';

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

  it('resolves Japanese captions and internal names without stripping their identity', () => {
    const sales = field({ caption: '売上', columnName: '[sales]' });
    const customerName = field({ columnName: '[顧客名]' });
    const schema = summary(sales, customerName);

    expect(resolveLooseFieldReference('売上', schema)).toEqual({
      kind: 'resolved',
      field: sales,
    });
    expect(resolveLooseFieldReference('顧客名', schema)).toEqual({
      kind: 'resolved',
      field: customerName,
    });
  });

  it('does not substitute a different mixed-script field with the same ASCII suffix', () => {
    const sales = field({ columnName: '[売上 Q1]' });

    expect(resolveLooseFieldReference('利益 Q1', summary(sales))).toMatchObject({
      kind: 'not_found',
    });
  });

  it('rejects unknown Japanese references', () => {
    const sales = field({ columnName: '[売上]' });

    expect(resolveLooseFieldReference('未知の項目', summary(sales))).toEqual({
      kind: 'not_found',
      candidates: [],
    });
  });

  it('reports duplicate Japanese captions as ambiguous', () => {
    const first = field({ caption: '売上', columnName: '[sales_primary]' });
    const second = field({ caption: '売上', columnName: '[sales_secondary]' });

    expect(resolveLooseFieldReference('売上', summary(first, second))).toEqual({
      kind: 'ambiguous',
      candidates: [first, second],
    });
  });

  it('preserves combining marks when distinguishing field names', () => {
    const plain = field({ columnName: '[Cafe]' });
    const accented = field({ columnName: '[Cafe\u0301]' });

    expect(resolveLooseFieldReference('Cafe\u0301', summary(plain, accented))).toEqual({
      kind: 'resolved',
      field: accented,
    });
  });

  it('returns one business-synonym match as a candidate without resolving it', () => {
    const sales = field({ caption: 'Sales', columnName: '[sales_amount]' });

    expect(resolveLooseFieldReference('Revenue', summary(sales))).toEqual({
      kind: 'not_found',
      candidates: [sales],
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

describe('calc-reference normalization isolation', () => {
  it('keeps repeated accented measures across tables ambiguous to the chart classifier', () => {
    const descriptor: RuntimeTemplateDescriptor = {
      template: 'bar',
      family: 'ranking',
      fast_path_eligible: true,
      fast_path_blockers: [],
      intent_keywords: ['bar'],
      description: 'bar chart',
      slots: [
        {
          slot_id: 'category',
          template_field: 'category',
          derivation: 'none',
          role: ['rows'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
        {
          slot_id: 'value',
          template_field: 'value',
          derivation: 'sum',
          role: ['columns'],
          kind: 'quantitative',
          bindable: true,
          required: true,
        },
      ],
      calcs: [],
    };
    const schema: SchemaSummary = {
      datasource: 'DS',
      fields: [
        {
          name: 'Region',
          columnName: '[Region]',
          role: 'dimension',
          type: 'nominal',
          datatype: 'string',
          datasource: 'DS',
          table: 'Dimensions',
          isAggregated: false,
          column_ref: '[DS].[none:Region:nk]',
        },
        {
          name: 'Revenuë',
          caption: 'Revenuë',
          columnName: '[Revenue Orders]',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'DS',
          table: 'Orders',
          isAggregated: false,
          column_ref: '[DS].[sum:Revenue Orders:qk]',
        },
        {
          name: 'Revenuë',
          columnName: '[Revenuë]',
          role: 'measure',
          type: 'quantitative',
          datatype: 'real',
          datasource: 'DS',
          table: 'Returns',
          isAggregated: false,
          column_ref: '[DS].[sum:Revenuë:qk]',
        },
      ],
    };

    expect(
      classifyNoLlm('bar of Revenuë by Region', new Map([['bar', descriptor]]), schema),
    ).toBeNull();
  });
});
