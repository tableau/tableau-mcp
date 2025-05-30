import { Field, Filter } from './vizqlDataServiceApi.js';

describe('Field schema', () => {
  it('accepts a minimal valid Field', () => {
    const data = { fieldCaption: 'Sales' };
    expect(() => Field.parse(data)).not.toThrow();
  });

  it('accepts a Field with a function', () => {
    const data = { fieldCaption: 'Profit', function: 'SUM' };
    expect(() => Field.parse(data)).not.toThrow();
  });

  it('accepts a Field with a calculation', () => {
    const data = { fieldCaption: 'Profit', calculation: 'SUM([Profit])' };
    expect(() => Field.parse(data)).not.toThrow();
  });

  it('rejects a Field missing fieldCaption', () => {
    const data = { function: 'SUM' };
    expect(() => Field.parse(data)).toThrow();
  });

  it('rejects a Field with extra properties (strict mode)', () => {
    const data = { fieldCaption: 'Sales', extra: 123 };
    expect(() => Field.parse(data)).toThrow();
  });

  it('rejects a Field with both function and calculation', () => {
    const data = { fieldCaption: 'Profit', function: 'SUM', calculation: 'SUM([Profit])' };
    expect(() => Field.parse(data)).toThrow();
  });
});

describe('SET Filter schema', () => {
  it('accepts a valid SET filter', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['Technology', 'Furniture'],
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid SET filter that excludes values', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['Technology', 'Furniture'],
      exclude: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a SET filter with a function', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category', function: 'SUM' },
      values: ['Technology', 'Furniture'],
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a SET filter with a calculation', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category', calculation: 'SUM([Sales])' },
      values: ['Technology', 'Furniture'],
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a SET filter with no values', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      exclude: true,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a SET filter with extra properties (strict mode)', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['A', 'B'],
      extra: 123,
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});

describe('TOP N Filter schema', () => {
  it('accepts a valid TOP N filter', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 5,
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid TOP N filter with a calculation', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 10,
      fieldToMeasure: { calculation: 'SUM([Revenue]) - SUM([Cost])' },
      direction: 'BOTTOM',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid TOP N filter with a function', () => {
    const data = {
      filterType: 'TOP',
      field: { calculation: 'MONTH([Order Date])' },
      howMany: 10,
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
      direction: 'BOTTOM',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a TOP N filter with no fieldToMeasure', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 5,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a TOP N filter with no howMany', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a TOP N filter with no field', () => {
    const data = {
      filterType: 'TOP',
      howMany: 5,
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a TOP N filter with extra properties (strict mode)', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 5,
      fieldToMeasure: { fieldCaption: 'Profit', function: 'SUM' },
      extra: 123,
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});

describe('MATCH Filter schema', () => {
  it('accepts a valid MATCH filter (contains)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      contains: 'Desk',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid MATCH filter (startsWith)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      startsWith: 'Desk',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid MATCH filter (endsWith)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      endsWith: 'Chair',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid MATCH filter with startsWith, endsWith, and contains', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      startsWith: 'Desk',
      endsWith: 'Chair',
      contains: 'Office',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a MATCH filter with none of startsWith, endsWith, or contains', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a MATCH filter if the field has a function', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name', function: 'SUM' },
      contains: 'Desk',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a MATCH filter if the field has a calculation', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name', calculation: 'SUM([Sales])' },
      contains: 'Desk',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a MATCH filter with extra properties (strict mode)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      contains: 'Desk',
      extra: 123,
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});

describe('QUANTITATIVE_NUMERICAL Filter schema', () => {
  it('accepts a valid QUANTITATIVE_NUMERICAL filter (RANGE)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (RANGE) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (RANGE) if missing min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      max: 1000,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (RANGE) if missing max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      min: 100,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (RANGE) if missing min and max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MIN)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MIN) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MIN) if missing min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MIN) which includes max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MAX)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Sales' },
      max: 1000,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MAX) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Sales' },
      max: 1000,
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MAX) if missing max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MAX) which includes min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (ONLY_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (ONLY_NULL) if it uses includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Sales' },
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (ONLY_NON_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (ONLY_NON_NULL) if it uses includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Sales' },
      includeNulls: false,
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});

describe('QUANTITATIVE_DATE Filter schema', () => {
  it('accepts a valid QUANTITATIVE_DATE filter (RANGE)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      maxDate: '2023-12-31',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (RANGE) with includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      maxDate: '2023-12-31',
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (RANGE) missing minDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
      maxDate: '2023-12-31',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (RANGE) missing maxDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (RANGE) missing minDate and maxDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MIN)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MIN) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MIN) missing minDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MIN) which includes max', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      maxDate: '2023-12-31',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MAX)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
      maxDate: '2023-12-31',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MAX) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
      maxDate: '2023-12-31',
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MAX) missing maxDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MAX) which includes min', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      maxDate: '2023-12-31',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (ONLY_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects an QUANTITATIVE_DATE filter (ONLY_NULL) with includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Order Date' },
      includeNulls: true,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (ONLY_NON_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects an QUANTITATIVE_DATE filter (ONLY_NON_NULL) with includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Order Date' },
      includeNulls: false,
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});

describe('DATE Filter schema', () => {
  it('accepts a valid DATE filter (CURRENT)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'YEARS',
      dateRangeType: 'CURRENT',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (LAST)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LAST',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (NEXT)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXT',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (TODATE)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'DAYS',
      dateRangeType: 'TODATE',
      anchorDate: '2025-01-01',
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (LASTN)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LASTN',
      rangeN: 3,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (NEXTN)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXTN',
      rangeN: 2,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects a DATE filter missing periodType', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      dateRangeType: 'CURRENT',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a DATE filter (TODATE) missing dateRangeType', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'DAYS',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a DATE filter (LASTN) missing rangeN', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LASTN',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a DATE filter (NEXTN) missing rangeN', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXTN',
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a DATE filter with rangeN (not NEXTN or LASTN)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'CURRENT',
      rangeN: 1,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a DATE filter with function', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date', function: 'SUM' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXT',
      rangeN: 1,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a DATE filter with calculation', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date', calculation: 'SUM([Sales])' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXT',
      rangeN: 1,
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});
