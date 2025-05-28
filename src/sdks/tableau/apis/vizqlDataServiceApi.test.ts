import { describe, expect, it } from 'vitest';

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

describe('Filter schema', () => {
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

  it('accepts a valid TOP N filter', () => {
    const data = {
      filterType: 'TOP',
      field: { fieldCaption: 'State' },
      howMany: 5,
      fieldToMeasure: { fieldCaption: 'Sales' },
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

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

  it('accepts a valid quantitative numerical filter (RANGE)', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      min: 100,
      max: 1000,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('accepts a valid quantitative numerical filter (RANGE) which includes nulls', () => {
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

  it('rejects a quantitative numerical filter (RANGE) if missing min', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      max: 1000,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('rejects a quantitative numerical filter (RANGE) if missing max', () => {
    const data = {
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'RANGE',
      field: { fieldCaption: 'Sales' },
      min: 100,
    };
    expect(() => Filter.parse(data)).toThrow();
  });

  it('accepts a valid relative date filter (LASTN)', () => {
    const data = {
      filterType: 'RELATIVE_DATE',
      field: { fieldCaption: 'Order Date' },
      periodType: 'MONTHS',
      dateRangeType: 'LASTN',
      rangeN: 3,
    };
    expect(() => Filter.parse(data)).not.toThrow();
  });

  it('rejects an invalid filter (missing required fields)', () => {
    const data = {
      filterType: 'SET',
      values: ['A', 'B'],
    };
    expect(() => Filter.parse(data)).toThrow();
  });
});
