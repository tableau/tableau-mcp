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
      "Invalid enum value. Expected 'name' | 'projectName' | 'createdAt' | 'updatedAt', received 'notAField'",
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
      "Invalid enum value. Expected 'eq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte', received 'badop'",
    );
  });

  it('throws on invalid operator for field', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:gt:5',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError("Operator 'gt' is not allowed for field 'name'. Allowed operators: eq");
  });

  it('throws on invalid format', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'nameeqvalue',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError('Invalid filter expression format: "nameeqvalue"');

    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:eq',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrowError('Invalid filter expression format: "name:eq"');
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

// ----------------------------------------------------------------------------
// Date-only auto-promotion — YYYY-MM-DD is rewritten to midnight UTC
// ----------------------------------------------------------------------------
// LLMs frequently emit `YYYY-MM-DD` when the user said "before Nov 20" with
// no time-of-day (it's the ISO date format and feels natural). The parser
// auto-promotes that bare date to canonical `YYYY-MM-DDT00:00:00Z` so a
// caller never gets a needless validation error for the most common
// natural-language case. Other ambiguous shapes (locale-style `MM/DD/YYYY`,
// no-timezone, `+HH:MM` offsets) remain rejected.
describe('parseAndValidateFilterString — date-only auto-promotion', () => {
  it('auto-promotes a date-only createdAt value to midnight UTC', () => {
    const result = parseAndValidateFilterString({
      filterString: 'createdAt:eq:2025-11-20',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('createdAt:eq:2025-11-20T00:00:00Z');
  });

  it('auto-promotes a date-only updatedAt value to midnight UTC', () => {
    const result = parseAndValidateFilterString({
      filterString: 'updatedAt:lt:2025-11-20',
      allowedOperatorsByField: {
        ...allowedOperatorsByField,
        updatedAt: ['eq', 'lt'],
      },
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('updatedAt:lt:2025-11-20T00:00:00Z');
  });

  it('preserves an already-canonical full ISO 8601 value unchanged', () => {
    // Regression guard: the auto-promotion path must never re-write a value
    // that is already in canonical form. Otherwise an LLM that did the right
    // thing first time would see its filter mutated.
    const result = parseAndValidateFilterString({
      filterString: 'createdAt:eq:2025-11-20T15:30:00Z',
      allowedOperatorsByField,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('createdAt:eq:2025-11-20T15:30:00Z');
  });

  it('rejects locale-style MM/DD/YYYY (ambiguous across locales)', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'createdAt:eq:11/20/2025',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow(/full ISO 8601 date-time with Z suffix.*or a date-only YYYY-MM-DD/);
  });

  it('rejects non-zero-padded date-only (2025-1-1)', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'createdAt:eq:2025-1-1',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
  });

  it('rejects no-timezone date-time (2025-11-20T00:00:00)', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'createdAt:eq:2025-11-20T00:00:00',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
  });

  it('rejects +HH:MM offset values (Tableau accepts these but the tool pins Z)', () => {
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'createdAt:eq:2025-11-20T00:00:00+00:00',
        allowedOperatorsByField,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow();
  });

  it('auto-promotes one date-only and preserves another canonical value in the same filter', () => {
    const result = parseAndValidateFilterString({
      filterString: 'createdAt:gte:2025-01-01,updatedAt:lt:2025-12-31T23:59:59Z',
      allowedOperatorsByField: {
        ...allowedOperatorsByField,
        createdAt: ['eq', 'gte'],
        updatedAt: ['eq', 'lt'],
      },
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('createdAt:gte:2025-01-01T00:00:00Z,updatedAt:lt:2025-12-31T23:59:59Z');
  });
});

// ----------------------------------------------------------------------------
// Bracket-aware top-level split — multi-element `:in:` lists
// ----------------------------------------------------------------------------
// The previous parser used a naive `split(',')` which shredded `name:in:[A,B]`
// into the broken sub-expressions `name:in:[A` and `B]`. Live verification on
// Tableau REST 3.30 surfaced this as a 100% failure on multi-element lists,
// even though every list-* tool documents `[A,B]` as the canonical `:in:`
// syntax. The fix tracks bracket depth so commas inside `[...]` are NOT
// treated as expression separators. These tests pin that contract.
describe('parseAndValidateFilterString — multi-element :in: lists', () => {
  const inAllowed: Record<FilterField, FilterOperator[]> = {
    name: ['eq', 'in'],
    projectName: ['eq', 'in'],
    createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
    updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  };

  it('preserves multi-element :in: list (the regression case)', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:in:[Foo,Bar]',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[Foo,Bar]');
  });

  it('preserves three-element :in: list', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:in:[Foo,Bar,Baz]',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[Foo,Bar,Baz]');
  });

  it('preserves single-element :in: list (regression guard)', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:in:[OnlyOne]',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[OnlyOne]');
  });

  it('handles a multi-element :in: list combined with another top-level filter', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:in:[Foo,Bar],projectName:eq:Default',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[Foo,Bar],projectName:eq:Default');
  });

  it('handles two multi-element :in: lists in the same filter string', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:in:[A,B],projectName:in:[X,Y,Z]',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[A,B],projectName:in:[X,Y,Z]');
  });

  it('still de-duplicates duplicate fields (keeps last) when one uses :in:', () => {
    const result = parseAndValidateFilterString({
      filterString: 'name:eq:First,name:in:[Second,Third]',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[Second,Third]');
  });

  it('preserves spaces inside bracketed lists', () => {
    // Tableau is whitespace-sensitive in name matching — if the user includes
    // a space inside the list value, we must pass it through verbatim.
    const result = parseAndValidateFilterString({
      filterString: 'name:in:[Foo Bar,Baz Qux]',
      allowedOperatorsByField: inAllowed,
      filterFieldSchema: FilterFieldSchema,
    });
    expect(result).toBe('name:in:[Foo Bar,Baz Qux]');
  });

  it('rejects unbalanced opening bracket with a clear, local error', () => {
    // Pre-validation surfaces the malformed input here, with a specific error
    // message naming the problem, instead of letting Tableau reject the bad
    // value one network round-trip later with a generic "bad filter syntax".
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:in:[A,B',
        allowedOperatorsByField: inAllowed,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow(/Unbalanced bracket.*'\[' opened with no matching '\]'/);
  });

  it('rejects stray closing bracket with a clear, local error', () => {
    // Mirrors the unbalanced-opening case: a `]` with no matching `[` is
    // rejected upfront rather than passed through to Tableau.
    expect(() =>
      parseAndValidateFilterString({
        filterString: 'name:eq:foo],projectName:eq:bar',
        allowedOperatorsByField: inAllowed,
        filterFieldSchema: FilterFieldSchema,
      }),
    ).toThrow(/Unbalanced bracket.*unexpected '\]' with no matching '\['/);
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
