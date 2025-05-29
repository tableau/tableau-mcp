import { z } from 'zod';

import { Filter, FilterField, TopNFilter } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { validateFilters } from './validateFilters.js';

describe('validateFilters', () => {
  it('should not throw if filters is undefined', () => {
    expect(() => validateFilters(undefined)).not.toThrow();
  });

  it('should not throw for a single filter', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['A', 'B'],
          context: false,
          exclude: false,
        },
      ]),
    ).not.toThrow();
  });

  it('should not throw for multiple filters on different fields', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['A', 'B'],
          context: false,
          exclude: false,
        },
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['East', 'West'],
          context: false,
          exclude: false,
        },
      ]),
    ).not.toThrow();
  });

  it('should throw if there are multiple filters for the same field', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['A', 'B'],
          context: false,
          exclude: false,
        },
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['C'],
          context: false,
          exclude: false,
        },
      ]),
    ).toThrow('The query must not include multiple filters for the following fields: Category.');
  });

  it('should throw if there are multiple filters for multiple same fields', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['A'],
          context: false,
          exclude: false,
        },
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['B'],
          context: false,
          exclude: false,
        },
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['East'],
          context: false,
          exclude: false,
        },
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['West'],
          context: false,
          exclude: false,
        },
      ]),
    ).toThrow(
      'The query must not include multiple filters for the following fields: Category, Region.',
    );
  });

  it('should not throw for filters with different field types', () => {
    const field1: z.infer<typeof FilterField> = {
      fieldCaption: 'Category',
      function: 'SUM',
    };

    const filter1: z.infer<typeof Filter> = {
      field: field1,
      filterType: 'SET',
      values: ['A'],
      context: false,
      exclude: false,
    };

    const field2: z.infer<typeof FilterField> = {
      fieldCaption: 'Region',
    };

    const filter2: z.infer<typeof Filter> = {
      field: field2,
      filterType: 'SET',
      values: ['East'],
      context: false,
      exclude: false,
    };

    expect(() => validateFilters([filter1, filter2])).not.toThrow();
  });

  it('should not throw for filters where a calculation will be used to filter on', () => {
    const field: z.infer<typeof FilterField> = {
      calculation: 'SUM(Sales)',
    };

    const filter: z.infer<typeof TopNFilter> = {
      field: field,
      filterType: 'TOP',
      howMany: 10,
      fieldToMeasure: field,
      direction: 'TOP',
      context: false,
    };

    expect(() => validateFilters([filter])).not.toThrow();
  });
});
