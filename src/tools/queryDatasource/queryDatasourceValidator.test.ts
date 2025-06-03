import { validateQuery } from './queryDatasourceValidator.js';

describe('validateQuery', () => {
  it('should throw if the query does not match the expected schema', () => {
    const query = {
      fields: [
        {
          fieldCaption: 'Sales',
        },
      ],
      filters: [
        {
          field: { fieldCaption: 'Date' },
          filterType: 'QUANTITATIVE_DATE',
          minDate: '2025-03-14',
          maxDate: '2025-03-14',
          context: false,
          includeNulls: false,
          quantitativeFilterType: 'MIN',
        },
      ],
    } as const;

    // @ts-expect-error - This is a test for the type validator
    expect(() => validateQuery({ datasourceLuid: '123', query })).toThrow(
      'The query does not match the expected schema.',
    );
  });
});
