import { describe, expect, it } from 'vitest';

import {
  FilterFieldSchema,
  FilterOperatorSchema,
  isOperatorAllowed,
  parseAndValidateFilterString,
} from './datasourcesFilterUtils.js';

// --- parseAndValidateFilterString ---
describe('parseAndValidateFilterString', () => {
  it('parses and validates a single valid filter', () => {
    const result = parseAndValidateFilterString('name:eq:Superstore');
    expect(result).toBe('name:eq:Superstore');
  });

  it('parses and validates multiple valid filters', () => {
    const result = parseAndValidateFilterString('name:eq:Superstore,projectName:eq:Finance');
    expect(result).toBe('name:eq:Superstore,projectName:eq:Finance');
  });

  it('throws on invalid field', () => {
    expect(() => parseAndValidateFilterString('notAField:eq:value')).toThrow();
  });

  it('throws on invalid operator', () => {
    expect(() => parseAndValidateFilterString('name:badop:value')).toThrow();
  });

  it('throws on invalid format', () => {
    expect(() => parseAndValidateFilterString('nameeqvalue')).toThrow();
    expect(() => parseAndValidateFilterString('name:eq')).toThrow();
  });

  it('keeps only the last filter for duplicate fields', () => {
    const result = parseAndValidateFilterString('name:eq:First,name:eq:Second');
    expect(result).toBe('name:eq:Second');
  });

  it('accepts valid ISO 8601 date-time for createdAt', () => {
    const result = parseAndValidateFilterString('createdAt:eq:2016-05-04T21:24:49Z');
    expect(result).toBe('createdAt:eq:2016-05-04T21:24:49Z');
  });

  it('throws on invalid date-time for createdAt', () => {
    expect(() => parseAndValidateFilterString('createdAt:eq:2016-05-04')).toThrow();
    expect(() => parseAndValidateFilterString('createdAt:eq:not-a-date')).toThrow();
    expect(() => parseAndValidateFilterString('createdAt:eq:2016-05-04T21:24:49')).toThrow();
  });

  it('accepts valid ISO 8601 date-time for updatedAt', () => {
    const result = parseAndValidateFilterString('updatedAt:eq:2020-12-31T23:59:59Z');
    expect(result).toBe('updatedAt:eq:2020-12-31T23:59:59Z');
  });

  it('throws on invalid date-time for updatedAt', () => {
    expect(() => parseAndValidateFilterString('updatedAt:eq:2020-12-31')).toThrow();
    expect(() => parseAndValidateFilterString('updatedAt:eq:2020-12-31T23:59:59')).toThrow();
    expect(() => parseAndValidateFilterString('updatedAt:eq:not-a-date')).toThrow();
  });
});

describe('isOperatorAllowed', () => {
  it('returns true for allowed operator', () => {
    expect(isOperatorAllowed('name', 'eq')).toBe(true);
    expect(isOperatorAllowed('projectName', 'eq')).toBe(true);
    expect(isOperatorAllowed('createdAt', 'gt')).toBe(true);
  });
  it('returns false for disallowed operator', () => {
    expect(isOperatorAllowed('name', 'gt')).toBe(false);
    expect(isOperatorAllowed('hasAlert', 'in')).toBe(false);
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
