import {
  datasourceModelResponseSchema,
  fieldSchema,
  filterSchema,
  queryPermissionsOutputSchema,
  userHasQueryPermissionsRequestSchema,
} from './vizqlDataServiceApi.js';

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

describe('Table calculation Field schema', () => {
  const dimensions = [{ fieldCaption: 'Category' }];
  const ref = { fieldCaption: 'Region' };
  const customSort = { fieldCaption: 'Sales', function: 'SUM', direction: 'DESC' };
  const tableCalcField = (tableCalculation: Record<string, unknown>): Record<string, unknown> => ({
    fieldCaption: 'Sales',
    function: 'SUM',
    tableCalculation,
  });

  it.each([
    { tableCalcType: 'CUSTOM', dimensions, levelAddress: ref, restartEvery: ref, customSort },
    { tableCalcType: 'NESTED', dimensions, fieldCaption: 'Inner', levelAddress: ref, customSort },
    { tableCalcType: 'DIFFERENCE_FROM', dimensions, relativeTo: 'PREVIOUS', customSort },
    { tableCalcType: 'PERCENT_DIFFERENCE_FROM', dimensions, relativeTo: 'FIRST' },
    { tableCalcType: 'PERCENT_FROM', dimensions, levelAddress: ref, relativeTo: 'LAST' },
    { tableCalcType: 'PERCENT_OF_TOTAL', dimensions, levelAddress: ref, customSort },
    { tableCalcType: 'RANK', dimensions, rankType: 'MODIFIED COMPETITION', direction: 'DESC' },
    { tableCalcType: 'PERCENTILE', dimensions, direction: 'ASC' },
    { tableCalcType: 'RUNNING_TOTAL', dimensions, aggregation: 'AVG', restartEvery: ref },
    {
      tableCalcType: 'MOVING_CALCULATION',
      dimensions,
      aggregation: 'MAX',
      previous: 2,
      next: 1,
      includeCurrent: false,
      fillInNull: true,
      customSort,
    },
  ])('accepts a $tableCalcType table calculation', (tableCalculation) => {
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).not.toThrow();
  });

  it('accepts UNSPECIFIED in the table calc enums', () => {
    for (const tableCalculation of [
      { tableCalcType: 'RANK', dimensions, rankType: 'UNSPECIFIED' },
      { tableCalcType: 'DIFFERENCE_FROM', dimensions, relativeTo: 'UNSPECIFIED' },
      { tableCalcType: 'RUNNING_TOTAL', dimensions, aggregation: 'UNSPECIFIED' },
    ]) {
      expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).not.toThrow();
    }
  });

  it('accepts a table calc on a calculation, and on a bare field caption', () => {
    const tableCalculation = { tableCalcType: 'RANK', dimensions };
    expect(() =>
      fieldSchema.parse({ fieldCaption: 'X', calculation: 'SUM([Sales])', tableCalculation }),
    ).not.toThrow();
    expect(() => fieldSchema.parse({ fieldCaption: 'X', tableCalculation })).not.toThrow();
  });

  it('accepts nestedTableCalculations, including null', () => {
    const nested = { tableCalcType: 'NESTED', dimensions, fieldCaption: 'Inner' };
    for (const nestedTableCalculations of [[nested], null]) {
      expect(() =>
        fieldSchema.parse({ ...tableCalcField(nested), nestedTableCalculations }),
      ).not.toThrow();
    }
  });

  it('accepts one level of secondaryTableCalculation', () => {
    const tableCalculation = {
      tableCalcType: 'RUNNING_TOTAL',
      dimensions,
      secondaryTableCalculation: { tableCalcType: 'PERCENT_OF_TOTAL', dimensions },
    };
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).not.toThrow();
  });

  it.each(['DIFFERENCE_FROM', 'PERCENT_DIFFERENCE_FROM', 'PERCENT_FROM', 'RANK', 'PERCENTILE'])(
    'accepts %s as a secondaryTableCalculation',
    (secondaryType) => {
      const tableCalculation = {
        tableCalcType: 'MOVING_CALCULATION',
        dimensions,
        secondaryTableCalculation: { tableCalcType: secondaryType, dimensions },
      };
      expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).not.toThrow();
    },
  );

  // VDS rejects these as secondaries; RUNNING_TOTAL and MOVING_CALCULATION would also nest.
  it.each(['CUSTOM', 'NESTED', 'RUNNING_TOTAL', 'MOVING_CALCULATION'])(
    'rejects %s as a secondaryTableCalculation',
    (secondaryType) => {
      const tableCalculation = {
        tableCalcType: 'RUNNING_TOTAL',
        dimensions,
        secondaryTableCalculation: {
          tableCalcType: secondaryType,
          dimensions,
          ...(secondaryType === 'NESTED' ? { fieldCaption: 'X' } : {}),
        },
      };
      expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).toThrow();
    },
  );

  it('rejects NESTED without a fieldCaption', () => {
    const tableCalculation = { tableCalcType: 'NESTED', dimensions };
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).toThrow();
  });

  it('rejects a table calculation without dimensions', () => {
    const tableCalculation = { tableCalcType: 'RANK' };
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).toThrow();
  });

  it('rejects an unknown tableCalcType', () => {
    const tableCalculation = { tableCalcType: 'MEDIAN', dimensions };
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).toThrow();
  });

  it.each([
    ['a property from another variant', { tableCalcType: 'RANK', dimensions, relativeTo: 'NEXT' }],
    ['an extra property on a dimension', { tableCalcType: 'RANK', dimensions: [{ ...ref, x: 1 }] }],
    [
      'a customSort missing its direction',
      {
        tableCalcType: 'PERCENT_OF_TOTAL',
        dimensions,
        customSort: { ...customSort, direction: undefined },
      },
    ],
  ])('rejects a table calculation with %s', (_, tableCalculation) => {
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).toThrow();
  });

  it('rejects a non-integer moving window', () => {
    const tableCalculation = { tableCalcType: 'MOVING_CALCULATION', dimensions, previous: 1.5 };
    expect(() => fieldSchema.parse(tableCalcField(tableCalculation))).toThrow();
  });

  it('rejects a table calc field with extra properties (strict mode)', () => {
    const data = { ...tableCalcField({ tableCalcType: 'RANK', dimensions }), binSize: 10 };
    expect(() => fieldSchema.parse(data)).toThrow();
  });

  // Guards the union order: with the table calc variant listed later, the error would come
  // from the dimension variant and say to remove `function` and `tableCalculation`.
  it('reports a mistake inside tableCalculation at its own path', () => {
    const result = fieldSchema.safeParse(
      tableCalcField({ tableCalcType: 'RANK', dimensions, bogus: 1 }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'unrecognized_keys',
        keys: ['bogus'],
        path: ['tableCalculation'],
      }),
    ]);
  });
});

describe('user-has-query-permissions request schema', () => {
  it('accepts a request with a datasourceLuid', () => {
    const data = { datasource: { datasourceLuid: 'abc-123' } };
    expect(() => userHasQueryPermissionsRequestSchema.parse(data)).not.toThrow();
  });

  it('rejects a request with an empty datasourceLuid', () => {
    const data = { datasource: { datasourceLuid: '' } };
    expect(() => userHasQueryPermissionsRequestSchema.parse(data)).toThrow();
  });

  it('rejects a request missing the datasource', () => {
    expect(() => userHasQueryPermissionsRequestSchema.parse({})).toThrow();
  });
});

describe('query permissions output schema', () => {
  it('accepts a minimal output with only hasQueryPermission', () => {
    expect(() => queryPermissionsOutputSchema.parse({ hasQueryPermission: true })).not.toThrow();
  });

  it('preserves a full real response (WORKBOOK with workbook + upstream resources) via passthrough', () => {
    const data = {
      hasQueryPermission: false,
      datasourceType: 'WORKBOOK',
      resources: [
        {
          resourceType: 'Workbook',
          luid: 'wb-1',
          capabilities: [
            { name: 'Read', mode: 'Allow' },
            { name: 'Connect', mode: 'Allow' },
            { name: 'VizqlDataApiAccess', mode: 'Allow' },
          ],
        },
        {
          resourceType: 'Datasource',
          luid: 'upstream-pds-1',
          capabilities: [
            { name: 'Read', mode: 'Deny' },
            { name: 'Connect', mode: 'Deny' },
            { name: 'VizqlDataApiAccess', mode: 'Deny' },
          ],
        },
      ],
    };
    expect(queryPermissionsOutputSchema.parse(data)).toEqual(data);
  });

  it('tolerates unknown diagnostic fields (passthrough)', () => {
    const data = { hasQueryPermission: false, unexpected: { nested: true } };
    expect(() => queryPermissionsOutputSchema.parse(data)).not.toThrow();
  });

  it('rejects output missing hasQueryPermission', () => {
    expect(() => queryPermissionsOutputSchema.parse({ datasourceType: 'EMBEDDED' })).toThrow();
  });

  it('rejects a non-boolean hasQueryPermission', () => {
    expect(() => queryPermissionsOutputSchema.parse({ hasQueryPermission: 'yes' })).toThrow();
  });

  it('rejects a capability whose mode is not Allow or Deny', () => {
    const data = {
      hasQueryPermission: false,
      resources: [{ capabilities: [{ name: 'Connect', mode: 'Maybe' }] }],
    };
    expect(() => queryPermissionsOutputSchema.parse(data)).toThrow();
  });
});

describe('Datasource model response schema', () => {
  it('accepts a single-table model with no relationships', () => {
    const data = {
      logicalTables: [{ logicalTableId: 'pp-2025.csv_35B9C215', caption: 'pp-2025.csv' }],
      logicalTableRelationships: [],
    };
    expect(() => datasourceModelResponseSchema.parse(data)).not.toThrow();
  });

  it('accepts a multi-table model with relationships that include an expression', () => {
    const data = {
      logicalTables: [
        { logicalTableId: 'Orders_ECFCA1FB', caption: 'Orders' },
        { logicalTableId: 'People_D7302373', caption: 'People' },
      ],
      logicalTableRelationships: [
        {
          fromLogicalTable: { logicalTableId: 'Orders_ECFCA1FB' },
          toLogicalTable: { logicalTableId: 'People_D7302373' },
          expression: {
            op: 'and',
            relationships: [{ operator: '=', fromField: 'Region', toField: 'Region' }],
          },
        },
      ],
    };
    expect(() => datasourceModelResponseSchema.parse(data)).not.toThrow();
  });

  it('accepts a multi-table model with relationships that omit the expression', () => {
    // Reproduces tableau/tableau-mcp#364: Tableau returns relationships without
    // an `expression` key when the relationship is implicit.
    const data = {
      logicalTables: [
        { logicalTableId: 'Orders_ECFCA1FB' },
        { logicalTableId: 'People_D7302373' },
        { logicalTableId: 'Returns_2AA0FE4D' },
      ],
      logicalTableRelationships: [
        {
          fromLogicalTable: { logicalTableId: 'Orders_ECFCA1FB' },
          toLogicalTable: { logicalTableId: 'People_D7302373' },
        },
        {
          fromLogicalTable: { logicalTableId: 'Orders_ECFCA1FB' },
          toLogicalTable: { logicalTableId: 'Returns_2AA0FE4D' },
        },
      ],
    };
    expect(() => datasourceModelResponseSchema.parse(data)).not.toThrow();
  });

  it('leaves a missing expression absent rather than synthesizing one', () => {
    const data = {
      logicalTables: [{ logicalTableId: 'Orders_ECFCA1FB' }, { logicalTableId: 'People_D7302373' }],
      logicalTableRelationships: [
        {
          fromLogicalTable: { logicalTableId: 'Orders_ECFCA1FB' },
          toLogicalTable: { logicalTableId: 'People_D7302373' },
        },
      ],
    };
    const parsed = datasourceModelResponseSchema.parse(data);
    expect(parsed.logicalTableRelationships[0]).not.toHaveProperty('expression');
    expect(parsed.logicalTableRelationships[0].expression).toBeUndefined();
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

  it('accepts a SET filter with mixed value types and null', () => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['Furniture', 1, true, null],
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it.each([[{ a: 1 }], [['Furniture']]])('rejects a SET filter value of %j', (value) => {
    const data = {
      filterType: 'SET',
      field: { fieldCaption: 'Category' },
      values: ['Furniture', value],
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });
});

describe('CONDITION Filter schema', () => {
  const condition = { fieldCaption: 'Sales', function: 'SUM', comparison: '>', value: 1000 };

  it('accepts a CONDITION filter with a condition', () => {
    const data = { filterType: 'CONDITION', field: { fieldCaption: 'Customer Name' }, condition };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a CONDITION filter with a calculation', () => {
    const data = {
      filterType: 'CONDITION',
      field: { fieldCaption: 'Customer Name' },
      calculation: 'SUM([Sales]) > 1000',
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('accepts a date string as the condition value', () => {
    const data = {
      filterType: 'CONDITION',
      field: { fieldCaption: 'Customer Name' },
      condition: { ...condition, function: 'MAX', fieldCaption: 'Order Date', value: '2024-01-01' },
    };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  // The validator, not the schema, requires exactly one of condition and calculation.
  it.each([
    ['neither', {}],
    ['both', { condition, calculation: 'SUM([Sales]) > 1000' }],
  ])('accepts a CONDITION filter with %s condition and calculation', (_, extra) => {
    const data = { filterType: 'CONDITION', field: { fieldCaption: 'Customer Name' }, ...extra };
    expect(() => filterSchema.parse(data)).not.toThrow();
  });

  it('rejects an unknown comparison', () => {
    const data = {
      filterType: 'CONDITION',
      field: { fieldCaption: 'Customer Name' },
      condition: { ...condition, comparison: '!=' },
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it('rejects a condition missing its function', () => {
    const { function: _, ...withoutFunction } = condition;
    const data = {
      filterType: 'CONDITION',
      field: { fieldCaption: 'Customer Name' },
      condition: withoutFunction,
    };
    expect(() => filterSchema.parse(data)).toThrow();
  });

  it.each([
    ['the filter', { extra: 1 }],
    ['the condition', { condition: { ...condition, extra: 1 } }],
  ])('rejects extra properties on %s (strict mode)', (_, extra) => {
    const data = {
      filterType: 'CONDITION',
      field: { fieldCaption: 'Customer Name' },
      condition,
      ...extra,
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
