/**
 * JQ Query Tests
 * 
 * Tests for the jq-web based query execution against WorkbookContext.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';

import { parseTwbFile } from './twbParser';
import { executeJqQuery, isJqAvailable } from './jqQuery';
import type { WorkbookContext } from './types';

const SUPERSTORE_TWB_PATH = path.resolve(__dirname, '../../twbs/Superstore_extracted/Superstore.twb');

describe('JQ Query', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH);
  });

  describe('isJqAvailable', () => {
    it('should always return true with jq-web', async () => {
      const available = await isJqAvailable();
      expect(available).toBe(true);
    });
  });

  describe('executeJqQuery', () => {
    it('should extract workbook name', async () => {
      const result = await executeJqQuery(context, '.workbookName');

      expect(result.success).toBe(true);
      expect(result.data).toBe('Superstore_us');
    });

    it('should list data source names', async () => {
      const result = await executeJqQuery(context, '[.dataSources[] | .dataSourceName]');

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data).toContain('Sample - Superstore');
    });

    it('should filter to specific data source', async () => {
      const result = await executeJqQuery(
        context,
        '.dataSources[] | select(.dataSourceName == "Sample - Superstore") | .dataSourceName'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe('Sample - Superstore');
    });

    it('should get field count', async () => {
      const result = await executeJqQuery(
        context,
        '.dataSources[] | select(.dataSourceName == "Sample - Superstore") | .fields | length'
      );

      expect(result.success).toBe(true);
      expect(typeof result.data).toBe('number');
      expect(result.data).toBeGreaterThan(0);
    });

    it('should project specific fields', async () => {
      const result = await executeJqQuery(
        context,
        '[.dataSources[] | {name: .dataSourceName, fieldCount: (.fields | length)}]'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data[0]).toHaveProperty('name');
      expect(result.data[0]).toHaveProperty('fieldCount');
    });

    it('should get worksheets', async () => {
      const result = await executeJqQuery(
        context,
        '[.worksheets[] | .worksheetName] | length'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBe(22); // Superstore has 22 worksheets
    });

    it('should get parameters', async () => {
      const result = await executeJqQuery(
        context,
        '[.parameters[] | {name: .name, value: .currentValue}]'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBe(6); // 6 parameters
    });

    it('should handle invalid jq syntax', async () => {
      const result = await executeJqQuery(context, '.invalid[[[');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should get visible fields only', async () => {
      const result = await executeJqQuery(
        context,
        '[.dataSources[] | select(.dataSourceName == "Sample - Superstore") | .fields[] | select(.isHidden == false) | .fieldCaption // .fieldName]'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it('should get calculations with formulas', async () => {
      const result = await executeJqQuery(
        context,
        '[.dataSources[] | .calculations[] | {name: .name, formula: .formula}] | length'
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeGreaterThan(0);
    });
  });

  describe('Security', () => {
    it('should treat command substitution as invalid jq syntax', async () => {
      const result = await executeJqQuery(context, '$(whoami)');

      // jq-web treats this as invalid syntax, not command substitution
      expect(result.success).toBe(false);
    });

    it('should treat backtick as invalid jq syntax', async () => {
      const result = await executeJqQuery(context, '`whoami`');

      // jq-web treats this as invalid syntax
      expect(result.success).toBe(false);
    });
  });
});
