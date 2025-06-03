import { z } from 'zod';

import { MatchFilter } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
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

  it('should throw if a filter is missing the field property', () => {
    // @ts-expect-error - This is a test for the type validator
    expect(() => validateFilters([{ filterType: 'SET', values: ['A', 'B'] }])).toThrow(
      'The query must not include filters with invalid fields. The following field errors occurred: The filter must include a field property.',
    );
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

  it('should throw if any filter has an invalid field', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: '' },
          filterType: 'SET',
          values: ['A', 'B'],
          context: false,
          exclude: false,
        },
      ]),
    ).toThrow(
      'The query must not include filters with invalid fields. The following field errors occurred: The fieldCaption property must be a non-empty string.',
    );
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

  it('should throw if a filter has a function and a calculation', () => {
    const field = { function: 'SUM', calculation: 'SUM(Sales)' } as const;
    expect(() =>
      validateFilters([
        // @ts-expect-error - This is a test for the type validator
        {
          field,
          filterType: 'SET',
          values: ['A', 'B'],
        },
      ]),
    ).toThrow(
      'The query must not include filters with invalid fields. The following field errors occurred: The field must not contain both a function and a calculation.',
    );
  });

  it('should throw if filter has a fieldCaption and a calculation', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Category', calculation: 'SUM([Sales])' },
          filterType: 'TOP',
          howMany: 10,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' },
        },
      ]),
    ).toThrow(
      'The query must not include filters with invalid fields. The following field errors occurred: The field "Category" must not contain both a fieldCaption and a calculation.',
    );
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

  it('should throw if a Set Filter has a function', () => {
    const field = { fieldCaption: 'Category', function: 'SUM' } as const;
    expect(() =>
      validateFilters([
        {
          field,
          filterType: 'SET',
          values: ['A', 'B'],
          context: false,
          exclude: false,
        },
      ]),
    ).toThrow(
      'The query must not include Set Filters, Match Filters, or Relative Date Filters with functions or calculations.',
    );
  });

  it('should throw if a Set Filter has a calculation', () => {
    const field = { calculation: 'SUM(Sales)' } as const;
    expect(() =>
      validateFilters([
        // @ts-expect-error - This is a test for the type validator
        {
          field,
          filterType: 'SET',
          values: ['A', 'B'],
          context: false,
          exclude: false,
        },
      ]),
    ).toThrow(
      'The query must not include Set Filters, Match Filters, or Relative Date Filters with functions or calculations.',
    );
  });

  it('should throw if a Set Filter has an empty values array', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: [],
          context: false,
          exclude: false,
        },
      ]),
    ).toThrow('The query must not include Set Filters with an empty values array.');
  });

  it('should throw if a Quantitative Date Filter with type MIN has an invalid min date', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Date' },
          filterType: 'QUANTITATIVE_DATE',
          minDate: 'invalid',
          context: false,
          includeNulls: false,
          quantitativeFilterType: 'MIN',
        },
      ]),
    ).toThrow('The query must not include Quantitative Date Filters with invalid dates.');
  });

  it('should throw if a Quantitative Date Filter with type MAX has an invalid max date', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Date' },
          filterType: 'QUANTITATIVE_DATE',
          maxDate: 'invalid',
          context: false,
          includeNulls: false,
          quantitativeFilterType: 'MAX',
        },
      ]),
    ).toThrow('The query must not include Quantitative Date Filters with invalid dates.');
  });

  it('should throw if a Quantitative Date Filter with type RANGE has an invalid min date', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Date' },
          filterType: 'QUANTITATIVE_DATE',
          minDate: 'invalid',
          maxDate: '2025-03-14',
          context: false,
          includeNulls: false,
          quantitativeFilterType: 'RANGE',
        },
      ]),
    ).toThrow('The query must not include Quantitative Date Filters with invalid dates.');
  });

  it('should throw if a Quantitative Date Filter with type RANGE has an invalid max date', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Date' },
          filterType: 'QUANTITATIVE_DATE',
          minDate: '2025-03-14',
          maxDate: 'invalid',
          context: false,
          includeNulls: false,
          quantitativeFilterType: 'RANGE',
        },
      ]),
    ).toThrow('The query must not include Quantitative Date Filters with invalid dates.');
  });

  it('should throw if a Relative Date Filter has an invalid anchor date', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'Date' },
          filterType: 'DATE',
          anchorDate: 'invalid',
          context: false,
          includeNulls: false,
          dateRangeType: 'CURRENT',
          periodType: 'DAYS',
        },
      ]),
    ).toThrow('The query must not include Relative Date Filters with invalid anchor dates.');
  });

  it('should throw if a Top N Filter has an invalid field', () => {
    expect(() =>
      validateFilters([
        {
          field: { fieldCaption: 'State/Province' },
          filterType: 'TOP',
          howMany: 10,
          context: false,
          direction: 'TOP',
          fieldToMeasure: { fieldCaption: '' },
        },
      ]),
    ).toThrow(
      'The query must not include Top N filters with invalid fields. The following field errors occurred: The fieldCaption property must be a non-empty string.',
    );
  });

  it('should throw if a Match Filter has no startsWith, endsWith, or contains', () => {
    // @ts-expect-error - This is a test for the type validator
    const filter: z.infer<typeof MatchFilter> = {
      field: { fieldCaption: 'Category' },
      filterType: 'MATCH',
    };

    expect(() => validateFilters([filter])).toThrow(
      'The query must not include Match Filters with invalid fields. The following field errors occurred: The match filter for field "Category" must include at least one of the following properties: startsWith, endsWith, or contains.',
    );
  });
});
