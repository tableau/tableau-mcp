/**
 * Workbook Context Tools Tests
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

import { workbookContextStore } from './workbookContextStore';
import { parseTwbFile } from '../../workbookContext/twbParser';
import { queryContext } from '../../workbookContext/contextQuery';
import { executeJqQuery, isJqAvailable } from '../../workbookContext/jqQuery';
import { generateCompactIndex } from '../../workbookContext/contextFormatter';
import type { WorkbookContext } from '../../workbookContext/types';

const SUPERSTORE_TWB_PATH = path.resolve(__dirname, '../../../twbs/Superstore_extracted/Superstore.twb');

describe('WorkbookContextStore', () => {
  beforeEach(() => {
    workbookContextStore.clear();
  });

  afterEach(() => {
    workbookContextStore.clear();
  });

  it('should store and retrieve a context', async () => {
    const context = await parseTwbFile(SUPERSTORE_TWB_PATH);

    workbookContextStore.set('test-context', context);

    const retrieved = workbookContextStore.get('test-context');
    expect(retrieved).toBeDefined();
    expect(retrieved?.workbookName).toBe(context.workbookName);
  });

  it('should return undefined for non-existent context', () => {
    const result = workbookContextStore.get('non-existent');
    expect(result).toBeUndefined();
  });

  it('should check if context exists', async () => {
    const context = await parseTwbFile(SUPERSTORE_TWB_PATH);

    expect(workbookContextStore.has('test-context')).toBe(false);

    workbookContextStore.set('test-context', context);

    expect(workbookContextStore.has('test-context')).toBe(true);
  });

  it('should delete a context', async () => {
    const context = await parseTwbFile(SUPERSTORE_TWB_PATH);

    workbookContextStore.set('test-context', context);
    expect(workbookContextStore.has('test-context')).toBe(true);

    workbookContextStore.delete('test-context');
    expect(workbookContextStore.has('test-context')).toBe(false);
  });

  it('should list all context IDs', async () => {
    const context = await parseTwbFile(SUPERSTORE_TWB_PATH);

    workbookContextStore.set('context-1', context);
    workbookContextStore.set('context-2', context);

    const ids = workbookContextStore.list();
    expect(ids).toContain('context-1');
    expect(ids).toContain('context-2');
    expect(ids.length).toBe(2);
  });
});

describe('Tool Integration', () => {
  let context: WorkbookContext;
  let jqInstalled: boolean;

  beforeAll(async () => {
    jqInstalled = await isJqAvailable();
  });

  beforeEach(async () => {
    workbookContextStore.clear();
    context = await parseTwbFile(SUPERSTORE_TWB_PATH);
    workbookContextStore.set('superstore', context);
  });

  afterEach(() => {
    workbookContextStore.clear();
  });

  describe('Load and Query Flow (structured)', () => {
    it('should allow querying a loaded context with structured queries', () => {
      const storedContext = workbookContextStore.get('superstore');
      expect(storedContext).toBeDefined();

      const result = queryContext(storedContext!, 'dataSources');
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
    });

    it('should generate compact index for loaded context', () => {
      const storedContext = workbookContextStore.get('superstore');
      expect(storedContext).toBeDefined();

      const index = generateCompactIndex(storedContext!);
      expect(index).toContain('WORKBOOK:');
      expect(index).toContain('DATA SOURCES:');
      expect(index.length).toBeLessThan(2000); // Should be compact
    });
  });

  describe('Load and Query Flow (jq)', () => {
    it('should allow querying a loaded context with jq', async () => {
      if (!jqInstalled) {
        console.log('Skipping: jq not installed');
        return;
      }

      const storedContext = workbookContextStore.get('superstore');
      expect(storedContext).toBeDefined();

      const result = await executeJqQuery(storedContext!, '[.dataSources[] | .dataSourceName]');
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data).toContain('Sample - Superstore');
    });

    it('should support the full agent workflow with jq', async () => {
      if (!jqInstalled) {
        console.log('Skipping: jq not installed');
        return;
      }

      // 1. Agent gets compact index
      const storedContext = workbookContextStore.get('superstore');
      const compactIndex = generateCompactIndex(storedContext!);

      // Agent sees data sources in compact index
      expect(compactIndex).toContain('Sample - Superstore');

      // 2. Agent queries for data sources using jq
      const dsResult = await executeJqQuery(
        storedContext!,
        '.dataSources[] | select(.dataSourceName == "Sample - Superstore") | {name: .dataSourceName, fieldCount: (.fields | length)}'
      );
      expect(dsResult.success).toBe(true);
      expect(dsResult.data.name).toBe('Sample - Superstore');
      expect(dsResult.data.fieldCount).toBeGreaterThan(0);

      // 3. Agent drills into fields using jq
      const fieldsResult = await executeJqQuery(
        storedContext!,
        '[.dataSources[] | select(.dataSourceName == "Sample - Superstore") | .fields[] | select(.isHidden == false) | {name: .fieldName, caption: .fieldCaption, type: .dataType}] | length'
      );
      expect(fieldsResult.success).toBe(true);
      expect(fieldsResult.data).toBeGreaterThan(0);

      // 4. Agent queries a specific worksheet using jq
      const wsResult = await executeJqQuery(
        storedContext!,
        '.worksheets[] | select(.worksheetName == "Performance") | {name: .worksheetName, mark: .visualSpec.markType}'
      );
      expect(wsResult.success).toBe(true);
      expect(wsResult.data.name).toBe('Performance');
      expect(wsResult.data.mark).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle structured query errors gracefully', () => {
      const storedContext = workbookContextStore.get('superstore');

      const result = queryContext(storedContext!, 'invalidPath');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle jq syntax errors', async () => {
      if (!jqInstalled) {
        console.log('Skipping: jq not installed');
        return;
      }

      const storedContext = workbookContextStore.get('superstore');

      const result = await executeJqQuery(storedContext!, '.invalid[[[');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
