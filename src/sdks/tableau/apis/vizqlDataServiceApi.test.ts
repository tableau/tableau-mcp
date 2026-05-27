import { fieldSchema, filterSchema } from './vizqlDataServiceApi.js';

describe('Field schema', () => {
  it('accepts a minimal valid Field', () => {
    const data = { fieldCaption: 'Sales' };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a Field with a function', () => {
    const data = { fieldCaption: 'Profit', function: 'SUM' };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a Field with a calculation', () => {
    const data = { fieldCaption: 'Profit', calculation: 'SUM([Profit])' };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('rejects a Field missing fieldCaption', () => {
    const data = { function: 'SUM' };
    expect(() => fieldSchema.parse(data)).toThrow();
  });

  it('rejects a Field with extra properties (strict mode)', () => {
    const data = { fieldCaption: 'Sales', extra: 123 };
    expect(() => fieldSchema.parse(data)).toThrow();
  });

  it('rejects a Field with both function and calculation', () => {
    const data = { fieldCaption: 'Profit', function: 'SUM', calculation: 'SUM([Profit])' };
    expect(() => fieldSchema.parse(data)).toThrow();
  });
});

describe('Table Calculation schemas', () => {
  it('accepts a RANK table calculation field', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'RANK',
        dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Order Date', function: 'YEAR' }],
        rankType: 'COMPETITION',
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a PERCENT_OF_TOTAL table calculation field', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'PERCENT_OF_TOTAL',
        dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Order Date', function: 'YEAR' }],
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a RUNNING_TOTAL table calculation with restartEvery', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'RUNNING_TOTAL',
        dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Order Date', function: 'YEAR' }],
        restartEvery: { fieldCaption: 'Order Date', function: 'YEAR' },
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a DIFFERENCE_FROM table calculation', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'DIFFERENCE_FROM',
        dimensions: [{ fieldCaption: 'Order Date', function: 'YEAR' }],
        relativeTo: 'PREVIOUS',
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a MOVING_CALCULATION table calculation', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'MOVING_CALCULATION',
        dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Order Date', function: 'YEAR' }],
        aggregation: 'SUM',
        previous: -2,
        next: 1,
        includeCurrent: true,
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a RUNNING_TOTAL with a secondaryTableCalculation', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'RUNNING_TOTAL',
        dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Order Date', function: 'YEAR' }],
        aggregation: 'SUM',
        secondaryTableCalculation: {
          tableCalcType: 'PERCENT_DIFFERENCE_FROM',
          dimensions: [
            { fieldCaption: 'Region' },
            { fieldCaption: 'Order Date', function: 'YEAR' },
          ],
          relativeTo: 'PREVIOUS',
        },
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a CUSTOM table calculation with a calculation expression', () => {
    const data = {
      fieldCaption: 'MyDifferenceCalc',
      calculation: 'ZN(SUM([Sales])) - LOOKUP(ZN(SUM([Sales])), -1)',
      tableCalculation: {
        tableCalcType: 'CUSTOM',
        dimensions: [
          { fieldCaption: 'Region' },
          { fieldCaption: 'Segment' },
          { fieldCaption: 'Order Date', function: 'YEAR' },
        ],
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts a 3-nest CUSTOM field with NESTED entries', () => {
    const data = {
      fieldCaption: '3-nest',
      tableCalculation: { tableCalcType: 'CUSTOM', dimensions: [] },
      nestedTableCalculations: [
        {
          tableCalcType: 'NESTED',
          fieldCaption: '1-nest',
          dimensions: [
            { fieldCaption: 'Region' },
            { fieldCaption: 'Segment' },
            { fieldCaption: 'Order Date', function: 'YEAR' },
          ],
        },
        {
          tableCalcType: 'NESTED',
          fieldCaption: '2-nest',
          dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Segment' }],
          restartEvery: { fieldCaption: 'Region' },
        },
      ],
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('accepts MODIFIED COMPETITION as a rankType (literal space)', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'RANK',
        dimensions: [],
        rankType: 'MODIFIED COMPETITION',
      },
    };
    expect(() => fieldSchema.parse(data)).not.toThrow();
  });

  it('rejects MODIFIED_COMPETITION (underscore variant)', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'RANK',
        dimensions: [],
        rankType: 'MODIFIED_COMPETITION',
      },
    };
    expect(() => fieldSchema.parse(data)).toThrow();
  });

  it('rejects an unknown tableCalcType', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'UNKNOWN_TYPE',
        dimensions: [],
      },
    };
    expect(() => fieldSchema.parse(data)).toThrow();
  });

  it('rejects a tableCalculation missing required dimensions', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: { tableCalcType: 'RANK' },
    };
    expect(() => fieldSchema.parse(data)).toThrow();
  });

  it('rejects a tableCalculation with extra properties', () => {
    const data = {
      fieldCaption: 'Profit',
      function: 'SUM',
      tableCalculation: {
        tableCalcType: 'RANK',
        dimensions: [],
        bogus: true,
      },
    };
    expect(() => fieldSchema.parse(data)).toThrow();
  });
});

describe('SET Filter schema', () => {
  it('accepts a valid SET filter', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['Technology', 'Furniture'],
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid SET filter that excludes values', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['Technology', 'Furniture'],
      exclude: true,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a SET filter with a function', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Order Date', function: 'MONTH' },
      values: ['January', 'February'],
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a SET filter with a calculation', () => {
    const data = {
      filterType: 'SET',
      field: { calculation: 'QUARTER([Order Date])' },
      values: ['Q3', 'Q4'],
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a SET filter with no values', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      exclude: true,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a SET filter with extra properties (strict mode)', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['A', 'B'],
      extra: 123,
    };
    expect(() => filterSchema.parse(data)).toThrow();
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
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid TOP N filter with a calculation', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 10,
      fieldToMeasure: { calculation: 'SUM([Revenue]) - SUM([Cost])' },
      direction: 'BOTTOM',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid TOP N filter with a function', () => {
    const data = {
      filterType: 'TOP',
      field: { calculation: 'MONTH([Order Date])' },
      howMany: 10,
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
      direction: 'BOTTOM',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a TOP N filter with no fieldToMeasure', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 5,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a TOP N filter with no howMany', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a TOP N filter with no field', () => {
    const data = {
      filterType: 'TOP',
      howMany: 5,
      fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a TOP N filter with extra properties (strict mode)', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 5,
      fieldToMeasure: { fieldCaption: 'Profit', function: 'SUM' },
      extra: 123,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });
});

describe('MATCH Filter schema', () => {
  it('accepts a valid MATCH filter (contains)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      contains: 'Desk',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid MATCH filter (startsWith)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      startsWith: 'Desk',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid MATCH filter (endsWith)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      endsWith: 'Chair',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid MATCH filter with startsWith, endsWith, and contains', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      startsWith: 'Desk',
      endsWith: 'Chair',
      contains: 'Office',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a MATCH filter with none of startsWith, endsWith, or contains', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a MATCH filter if the field has a function', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name', function: 'SUM' },
      contains: 'Desk',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a MATCH filter if the field has a calculation', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name', calculation: 'SUM([Sales])' },
      contains: 'Desk',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a MATCH filter with extra properties (strict mode)', () => {
    const data = {
      filterType: 'MATCH',
      field: { fieldCaption: 'Product Name' },
      contains: 'Desk',
      extra: 123,
    };
    expect(() => filterSchema.parse(data)).toThrow();
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
    expect(() => filterSchema.parse(data)).not.toThrow();
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
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (RANGE) if missing min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      max: 1000,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (RANGE) if missing max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      min: 100,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (RANGE) if missing min and max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MIN)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MIN) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
      includeNulls: true,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MIN) if missing min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MIN) which includes max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MAX)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Sales' },
      max: 1000,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (MAX) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Sales' },
      max: 1000,
      includeNulls: true,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MAX) if missing max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (MAX) which includes min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (ONLY_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (ONLY_NULL) if it uses includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Sales' },
      includeNulls: true,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_NUMERICAL filter (ONLY_NON_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Sales' },
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_NUMERICAL filter (ONLY_NON_NULL) if it uses includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Sales' },
      includeNulls: false,
    };
    expect(() => filterSchema.parse(data)).toThrow();
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
    expect(() => filterSchema.parse(data)).not.toThrow();
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
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (RANGE) missing minDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
      maxDate: '2023-12-31',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (RANGE) missing maxDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (RANGE) missing minDate and maxDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MIN)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MIN) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      includeNulls: true,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MIN) missing minDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MIN) which includes max', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MIN',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      maxDate: '2023-12-31',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MAX)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
      maxDate: '2023-12-31',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (MAX) which includes nulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
      maxDate: '2023-12-31',
      includeNulls: true,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MAX) missing maxDate', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a QUANTITATIVE_DATE filter (MAX) which includes min', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'MAX',
      field: { fieldCaption: 'Order Date' },
      minDate: '2023-01-01',
      maxDate: '2023-12-31',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (ONLY_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects an QUANTITATIVE_DATE filter (ONLY_NULL) with includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NULL',
      field: { fieldCaption: 'Order Date' },
      includeNulls: true,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('accepts a valid QUANTITATIVE_DATE filter (ONLY_NON_NULL)', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Order Date' },
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects an QUANTITATIVE_DATE filter (ONLY_NON_NULL) with includeNulls', () => {
    const data = {
      filterType: 'QUANTITATIVE_DATE',
      quantitativeFilterType: 'ONLY_NON_NULL',
      field: { fieldCaption: 'Order Date' },
      includeNulls: false,
    };
    expect(() => filterSchema.parse(data)).toThrow();
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
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (LAST)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LAST',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (NEXT)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXT',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (TODATE)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'DAYS',
      dateRangeType: 'TODATE',
      anchorDate: '2025-01-01',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (LASTN)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LASTN',
      rangeN: 3,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a valid DATE filter (NEXTN)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXTN',
      rangeN: 2,
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects a DATE filter missing periodType', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      dateRangeType: 'CURRENT',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a DATE filter (TODATE) missing dateRangeType', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'DAYS',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a DATE filter (LASTN) missing rangeN', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LASTN',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a DATE filter (NEXTN) missing rangeN', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXTN',
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a DATE filter with rangeN (not NEXTN or LASTN)', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'CURRENT',
      rangeN: 1,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a DATE filter with function', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date', function: 'SUM' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXT',
      rangeN: 1,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a DATE filter with calculation', () => {
    const data = {
      filterType: 'DATE',
      field: { fieldCaption: 'Order Date', calculation: 'SUM([Sales])' },
      periodType: 'MONTHS',
      dateRangeType: 'NEXT',
      rangeN: 1,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });
});
