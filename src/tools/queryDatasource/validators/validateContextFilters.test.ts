import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { validateContextFilters } from './validateContextFilters.js';

const baseFields: Query['fields'] = [
  { fieldCaption: 'Product Name' },
  { fieldCaption: 'Sales', function: 'SUM', sortDirection: 'DESC', sortPriority: 1 },
];

describe('validateContextFilters', () => {
  it('should return no warnings when query has no filters', () => {
    const query: Query = { fields: baseFields };
    expect(validateContextFilters(query)).toEqual([]);
  });

  it('should return no warnings when query has empty filters', () => {
    const query: Query = { fields: baseFields, filters: [] };
    expect(validateContextFilters(query)).toEqual([]);
  });

  it('should return no warnings for a single filter', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
        },
      ],
    };
    expect(validateContextFilters(query)).toEqual([]);
  });

  it('should return no warnings for a single TOP filter', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 5,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };
    expect(validateContextFilters(query)).toEqual([]);
  });

  it('should return no warnings for multiple dimension filters without TOP', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
        },
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['Technology'],
        },
      ],
    };
    expect(validateContextFilters(query)).toEqual([]);
  });

  it('should return no warnings when dimension filters already have context: true', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
          context: true,
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 1,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };
    expect(validateContextFilters(query)).toEqual([]);
  });

  it('should return a warning when TOP filter is combined with SET filter missing context', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 1,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe('MISSING_CONTEXT_ON_DIMENSION_FILTER');
    expect(warnings[0].severity).toBe('WARNING');
    expect(warnings[0].affectedFilters).toEqual(['State']);
    expect(warnings[0].message).toContain("missing 'context: true'");
  });

  it('should return a warning when BOTTOM direction is used with dimension filter missing context', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['East'],
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 3,
          direction: 'BOTTOM',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['Region']);
  });

  it('should list multiple affected filters', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
        },
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['Technology'],
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 1,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['State', 'Category']);
  });

  it('should only flag dimension filters missing context, not those with context: true', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
          context: true,
        },
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['Technology'],
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 1,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['Category']);
  });

  it('should detect DATE filter missing context with TOP filter', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'Order Date' },
          filterType: 'DATE',
          periodType: 'YEARS',
          dateRangeType: 'LAST',
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 5,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['Order Date']);
  });

  it('should detect MATCH filter missing context with TOP filter', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'Customer Name' },
          filterType: 'MATCH',
          contains: 'Smith',
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 3,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['Customer Name']);
  });

  it('should detect QUANTITATIVE_NUMERICAL filter missing context with TOP filter', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'Profit', function: 'SUM' },
          filterType: 'QUANTITATIVE_NUMERICAL',
          quantitativeFilterType: 'RANGE',
          min: 0,
          max: 1000,
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 5,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['Profit']);
  });

  it('should detect QUANTITATIVE_DATE filter missing context with TOP filter', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'Order Date' },
          filterType: 'QUANTITATIVE_DATE',
          quantitativeFilterType: 'RANGE',
          minDate: '2024-01-01',
          maxDate: '2024-12-31',
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 5,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['Order Date']);
  });

  it('should not flag dimension filters that have context: false', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
          context: false,
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 1,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual(['State']);
  });

  it('should warn for calculated filter fields missing context', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { calculation: 'IF [Sales] > 100 THEN "High" ELSE "Low" END' },
          filterType: 'QUANTITATIVE_NUMERICAL',
          quantitativeFilterType: 'RANGE',
          min: 0,
          max: 500,
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 5,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual([
      'IF [Sales] > 100 THEN "High" ELSE "Low" END',
    ]);
  });

  it('should handle mixed calculated and named filters', () => {
    const query: Query = {
      fields: baseFields,
      filters: [
        {
          field: { calculation: 'IF [Sales] > 100 THEN "High" ELSE "Low" END' },
          filterType: 'QUANTITATIVE_NUMERICAL',
          quantitativeFilterType: 'RANGE',
          min: 0,
          max: 500,
        },
        {
          field: { fieldCaption: 'State' },
          filterType: 'SET',
          values: ['Massachusetts'],
        },
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'TOP',
          howMany: 5,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ],
    };

    const warnings = validateContextFilters(query);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedFilters).toEqual([
      'IF [Sales] > 100 THEN "High" ELSE "Low" END',
      'State',
    ]);
  });
});
