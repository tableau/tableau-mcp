import z from 'zod';

import {
  exportedForTesting,
  FilterOperator,
  parseAndValidateFilterString,
} from './parseAndValidateFilterString.js';

const { FilterOperatorSchema } = exportedForTesting;

const FilterFieldSchema = z.enum(['name', 'projectName', 'createdAt', 'updatedAt']);
type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  name: ['eq'],
  projectName: ['eq'],
  createdAt: ['eq'],
  updatedAt: ['eq'],
};

describe('parseAndValidateFilterString', () => {
  it('parses and validates a single valid filter', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:eq:Superstore',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:eq:Superstore');
  });

  it('parses and validates multiple valid filters', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:eq:Superstore,projectName:eq:Finance',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:eq:Superstore,projectName:eq:Finance');
  });

  it('throws on invalid field', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'notAField:eq:value',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError(
      `Invalid enum value. Expected 'name' | 'projectName' | 'createdAt' | 'updatedAt', received 'notAField'`,
    );
  });

  it('throws on invalid operator', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:badop:value',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError(
      `Invalid enum value. Expected 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte', received 'badop'`,
    );
  });

  it('throws on invalid operator for field', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:gt:5',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError(`Operator 'gt' is not allowed for field 'name'. Allowed operators: eq`);
  });

  it('throws on invalid format', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'nameeqvalue',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError(`Invalid filter expression format: "nameeqvalue"`);

    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:eq',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError(`Invalid filter expression format: "name:eq"`);
  });

  it('keeps only the last filter for duplicate fields', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:eq:First,name:eq:Second',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:eq:Second');
  });

  it('accepts valid ISO 8601 date-time for createdAt', () => {
    const result = parseAndValidateFilterString({
      filterString: 'createdAt:eq:2016-05-04T21:24:49Z',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('createdAt:eq:2016-05-04T21:24:49Z');
  });

  it('throws on invalid date-time for createdAt', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'createdAt:eq:2016-05-04',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'createdAt:eq:not-a-date',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
  });

  it('accepts valid ISO 8601 date-time for updatedAt', () => {
    const result = parseAndValidateFilterString({
      filterString: 'updatedAt:eq:2020-12-31T23:59:59Z',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('updatedAt:eq:2020-12-31T23:59:59Z');
  });

  it('throws on invalid date-time for updatedAt', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'updatedAt:eq:2020-12-31',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'updatedAt:eq:2020-12-31T23:59:59',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'updatedAt:eq:not-a-date',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
  });
});

describe('FilterFieldSchema', () => {
  it('parses valid field', () => {
    expect(FilterFieldSchema.parse('name')).toBe('name');
    expect(FilterFieldSchema.parse('projectName')).toBe('projectName');
  });
  it('throws on invalid field', () => {
    expect(() => FilterFieldSchema.parse('notAField')).toThrow();
  });
});

describe('FilterOperatorSchema', () => {
  it('parses valid operator', () => {
    expect(FilterOperatorSchema.parse('eq')).toBe('eq');
    expect(FilterOperatorSchema.parse('in')).toBe('in');
  });
  it('throws on invalid operator', () => {
    expect(() => FilterOperatorSchema.parse('badop')).toThrow();
  });
});
