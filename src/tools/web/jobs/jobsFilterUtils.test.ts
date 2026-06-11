import { describe, expect, it } from 'vitest';

import {
  exportedForTesting,
  parseAndValidateJobsFilterString,
} from './jobsFilterUtils.js';

const { FilterFieldSchema } = exportedForTesting;

describe('jobsFilterUtils', () => {
  describe('parseAndValidateJobsFilterString', () => {
    it('should parse valid single filter', () => {
      const result = parseAndValidateJobsFilterString('jobType:eq:refresh_extracts');
      expect(result).toBe('jobType:eq:refresh_extracts');
    });

    it('should parse multiple filters', () => {
      const result = parseAndValidateJobsFilterString(
        'jobType:eq:refresh_extracts,progress:lte:0',
      );
      expect(result).toBe('jobType:eq:refresh_extracts,progress:lte:0');
    });

    it('should parse has operator for title', () => {
      const result = parseAndValidateJobsFilterString('title:has:Superstore');
      expect(result).toBe('title:has:Superstore');
    });

    it('should parse has operator for notes', () => {
      const result = parseAndValidateJobsFilterString('notes:has:nightly');
      expect(result).toBe('notes:has:nightly');
    });

    it('should parse date filter with colons in value', () => {
      const result = parseAndValidateJobsFilterString('createdAt:gt:2026-05-01T11:00:56Z');
      expect(result).toBe('createdAt:gt:2026-05-01T11:00:56Z');
    });

    it('should parse in operator for status', () => {
      const result = parseAndValidateJobsFilterString('status:in:Failed|Cancelled');
      expect(result).toBe('status:in:Failed|Cancelled');
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
      expect(FilterFieldSchema.parse('createdAt')).toBe('createdAt');
      expect(FilterFieldSchema.parse('startedAt')).toBe('startedAt');
      expect(FilterFieldSchema.parse('endedAt')).toBe('endedAt');
      expect(FilterFieldSchema.parse('title')).toBe('title');
      expect(FilterFieldSchema.parse('notes')).toBe('notes');
    });

    it('should reject invalid fields', () => {
      expect(() => FilterFieldSchema.parse('type')).toThrow();
      expect(() => FilterFieldSchema.parse('completedAt')).toThrow();
      expect(() => FilterFieldSchema.parse('subtitle')).toThrow();
    });
  });
});
