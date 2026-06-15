import { describe, expect, it } from 'vitest';

import { exportedForTesting, parseAndValidateJobsFilterString } from './jobsFilterUtils.js';

const { FilterFieldSchema } = exportedForTesting;

describe('jobsFilterUtils', () => {
  describe('parseAndValidateJobsFilterString', () => {
    it('should parse valid single filter', () => {
      const result = parseAndValidateJobsFilterString('jobType:eq:refresh_extracts');
      expect(result).toBe('jobType:eq:refresh_extracts');
    });

    it('should parse multiple filters', () => {
      const result = parseAndValidateJobsFilterString('jobType:eq:refresh_extracts,progress:lte:0');
      expect(result).toBe('jobType:eq:refresh_extracts,progress:lte:0');
    });

    it('should parse date filter with colons in value', () => {
      const result = parseAndValidateJobsFilterString('createdAt:gt:2026-05-01T11:00:56Z');
      expect(result).toBe('createdAt:gt:2026-05-01T11:00:56Z');
    });

    it('should parse eq operator for status', () => {
      const result = parseAndValidateJobsFilterString('status:eq:Failed');
      expect(result).toBe('status:eq:Failed');
    });

    it('should parse in operator with a single bracketed value', () => {
      const result = parseAndValidateJobsFilterString('jobType:in:[refresh_extracts]');
      expect(result).toBe('jobType:in:[refresh_extracts]');
    });

    it('should keep commas inside a bracketed in-operator value', () => {
      const result = parseAndValidateJobsFilterString('jobType:in:[refresh_extracts,run_flow]');
      expect(result).toBe('jobType:in:[refresh_extracts,run_flow]');
    });

    it('should parse a bracketed in filter alongside another filter', () => {
      const result = parseAndValidateJobsFilterString(
        'jobType:in:[refresh_extracts,run_flow],progress:lte:0',
      );
      expect(result).toBe('jobType:in:[refresh_extracts,run_flow],progress:lte:0');
    });

    it('should throw on in operator without bracketed value', () => {
      expect(() =>
        parseAndValidateJobsFilterString('jobType:in:refresh_extracts,run_flow'),
      ).toThrow();
    });

    it('should parse completedAt date filter', () => {
      const result = parseAndValidateJobsFilterString('completedAt:lt:2026-05-25T00:00:00Z');
      expect(result).toBe('completedAt:lt:2026-05-25T00:00:00Z');
    });

    it('should throw on a date field with a non-ISO 8601 value', () => {
      expect(() => parseAndValidateJobsFilterString('createdAt:gt:2026-05-01')).toThrow();
    });

    it('should throw on a date field with a non-date value', () => {
      expect(() => parseAndValidateJobsFilterString('startedAt:gt:yesterday')).toThrow();
    });

    it('should parse has operator for title', () => {
      const result = parseAndValidateJobsFilterString('title:has:Superstore');
      expect(result).toBe('title:has:Superstore');
    });

    it('should parse has operator for notes', () => {
      const result = parseAndValidateJobsFilterString('notes:has:nightly');
      expect(result).toBe('notes:has:nightly');
    });

    it('should parse has operator for args', () => {
      const result = parseAndValidateJobsFilterString('args:has:datasource');
      expect(result).toBe('args:has:datasource');
    });

    it('should throw on invalid field', () => {
      expect(() => parseAndValidateJobsFilterString('invalidField:eq:value')).toThrow();
    });

    it('should throw on invalid operator for field', () => {
      expect(() => parseAndValidateJobsFilterString('jobType:gt:refresh_extracts')).toThrow();
    });

    it('should throw on has operator for non-text field', () => {
      expect(() => parseAndValidateJobsFilterString('progress:has:50')).toThrow();
    });

    it('should throw on eq operator for has-only field (notes)', () => {
      expect(() => parseAndValidateJobsFilterString('notes:eq:nightly')).toThrow();
    });

    it('should throw on in operator for status (eq only)', () => {
      expect(() => parseAndValidateJobsFilterString('status:in:Failed|Success')).toThrow();
    });

    it('should throw on invalid operator name', () => {
      expect(() => parseAndValidateJobsFilterString('jobType:contains:refresh')).toThrow();
    });

    it('should throw on malformed expression (missing value)', () => {
      expect(() => parseAndValidateJobsFilterString('jobType:eq')).toThrow();
    });

    it('should throw on malformed expression (missing operator)', () => {
      expect(() => parseAndValidateJobsFilterString('jobType')).toThrow();
    });
  });

  describe('FilterFieldSchema', () => {
    it('should accept valid fields', () => {
      expect(FilterFieldSchema.parse('jobType')).toBe('jobType');
      expect(FilterFieldSchema.parse('status')).toBe('status');
      expect(FilterFieldSchema.parse('progress')).toBe('progress');
      expect(FilterFieldSchema.parse('priority')).toBe('priority');
      expect(FilterFieldSchema.parse('title')).toBe('title');
      expect(FilterFieldSchema.parse('subtitle')).toBe('subtitle');
      expect(FilterFieldSchema.parse('notes')).toBe('notes');
      expect(FilterFieldSchema.parse('args')).toBe('args');
      expect(FilterFieldSchema.parse('createdAt')).toBe('createdAt');
      expect(FilterFieldSchema.parse('startedAt')).toBe('startedAt');
      expect(FilterFieldSchema.parse('completedAt')).toBe('completedAt');
    });

    it('should reject invalid fields', () => {
      expect(() => FilterFieldSchema.parse('type')).toThrow();
      expect(() => FilterFieldSchema.parse('endedAt')).toThrow();
      expect(() => FilterFieldSchema.parse('finishCode')).toThrow();
      expect(() => FilterFieldSchema.parse('jobName')).toThrow();
      expect(() => FilterFieldSchema.parse('updatedAt')).toThrow();
      expect(() => FilterFieldSchema.parse('siteId')).toThrow();
      expect(() => FilterFieldSchema.parse('argsYaml')).toThrow();
    });
  });
});
