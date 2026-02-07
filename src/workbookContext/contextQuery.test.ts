/**
 * Context Query Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';

import {
  parseTwbFile,
  queryContext,
  getQueryableFields,
  getWorksheetFields,
  generateCompactIndex,
  type WorkbookContext,
} from './index';

const SUPERSTORE_TWB_PATH = path.resolve(__dirname, '../../twbs/Superstore_extracted/Superstore.twb');

describe('Context Query', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  describe('queryContext', () => {
    describe('Data Sources', () => {
      it('should list all data sources', () => {
        const result = queryContext(context, 'dataSources');

        expect(result.success).toBe(true);
        expect(result.data).toBeInstanceOf(Array);
        expect(result.count).toBe(3);

        // Check structure
        const names = result.data.map((ds: any) => ds.name);
        expect(names).toContain('Sample - Superstore');
        expect(names).toContain('Sales Commission');
        expect(names).toContain('Sales Target');
      });

      it('should get specific data source by name', () => {
        const result = queryContext(context, 'dataSources[Sample - Superstore]');

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.name).toBe('Sample - Superstore');
        expect(result.data.fields).toBeInstanceOf(Array);
        expect(result.data.calculations).toBeInstanceOf(Array);
      });

      it('should get fields for a specific data source', () => {
        const result = queryContext(context, 'dataSources[Sample - Superstore].fields');

        expect(result.success).toBe(true);
        expect(result.data).toBeInstanceOf(Array);
        expect(result.count).toBeGreaterThan(0);

        // Check field structure
        const sampleField = result.data[0];
        expect(sampleField).toHaveProperty('name');
        expect(sampleField).toHaveProperty('dataType');
        expect(sampleField).toHaveProperty('role');
      });

      it('should get calculations for a specific data source', () => {
        const result = queryContext(context, 'dataSources[Sample - Superstore].calculations');

        expect(result.success).toBe(true);
        expect(result.data).toBeInstanceOf(Array);
        expect(result.count).toBeGreaterThan(0);

        // Check calculation structure
        const sampleCalc = result.data[0];
        expect(sampleCalc).toHaveProperty('name');
        expect(sampleCalc).toHaveProperty('formula');
      });

      it('should exclude hidden fields by default', () => {
        const result = queryContext(context, 'dataSources[Sample - Superstore].fields');

        expect(result.success).toBe(true);
        const hiddenFields = result.data.filter((f: any) => f.isHidden);
        expect(hiddenFields.length).toBe(0);
      });

      it('should include hidden fields when option is set', () => {
        const result = queryContext(context, 'dataSources[Sample - Superstore].fields', {
          includeHidden: true,
        });

        expect(result.success).toBe(true);
        const hiddenFields = result.data.filter((f: any) => f.isHidden);
        expect(hiddenFields.length).toBeGreaterThan(0);
      });

      it('should return error for non-existent data source', () => {
        const result = queryContext(context, 'dataSources[NonExistent]');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Data source not found');
      });
    });

    describe('Worksheets', () => {
      it('should list all worksheets', () => {
        const result = queryContext(context, 'worksheets');

        expect(result.success).toBe(true);
        expect(result.data).toBeInstanceOf(Array);
        expect(result.count).toBeGreaterThan(0);

        // Check structure
        const sampleWs = result.data[0];
        expect(sampleWs).toHaveProperty('name');
        expect(sampleWs).toHaveProperty('markType');
      });

      it('should get specific worksheet by name', () => {
        const result = queryContext(context, 'worksheets[Performance]');

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.name).toBe('Performance');
        expect(result.data.visualSpec).toBeDefined();
      });

      it('should return error for non-existent worksheet', () => {
        const result = queryContext(context, 'worksheets[NonExistent]');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Worksheet not found');
      });
    });

    describe('Dashboards', () => {
      it('should list all dashboards', () => {
        const result = queryContext(context, 'dashboards');

        expect(result.success).toBe(true);
        expect(result.data).toBeInstanceOf(Array);
        expect(result.count).toBeGreaterThan(0);

        // Check structure
        const sampleDb = result.data[0];
        expect(sampleDb).toHaveProperty('name');
        expect(sampleDb).toHaveProperty('worksheetCount');
        expect(sampleDb).toHaveProperty('worksheets');
      });

      it('should get specific dashboard by name', () => {
        const result = queryContext(context, 'dashboards[Overview]');

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.name).toBe('Overview');
        expect(result.data.worksheets).toBeInstanceOf(Array);
      });
    });

    describe('Parameters', () => {
      it('should list all parameters', () => {
        const result = queryContext(context, 'parameters');

        expect(result.success).toBe(true);
        expect(result.data).toBeInstanceOf(Array);
        expect(result.count).toBeGreaterThan(0);

        // Check structure
        const sampleParam = result.data[0];
        expect(sampleParam).toHaveProperty('name');
        expect(sampleParam).toHaveProperty('dataType');
        expect(sampleParam).toHaveProperty('domainType');
      });
    });

    describe('Required Filters', () => {
      it('should return required filters', () => {
        const result = queryContext(context, 'requiredFilters');

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('dataSourceFilters');
        expect(result.data).toHaveProperty('applyToAllFilters');
      });
    });

    describe('Analyst Guidance', () => {
      it('should return analyst guidance', () => {
        const result = queryContext(context, 'analystGuidance');

        expect(result.success).toBe(true);
        // May be null if no guidance is defined
      });
    });

    describe('Error Handling', () => {
      it('should return error for unknown root', () => {
        const result = queryContext(context, 'unknownRoot');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unknown query root');
      });
    });
  });

  describe('getQueryableFields', () => {
    it('should return dimensions and measures', () => {
      const { dimensions, measures } = getQueryableFields(context);

      expect(dimensions).toBeInstanceOf(Array);
      expect(measures).toBeInstanceOf(Array);
      expect(dimensions.length).toBeGreaterThan(0);
      expect(measures.length).toBeGreaterThan(0);
    });

    it('should filter by data source name', () => {
      const { dimensions, measures } = getQueryableFields(context, 'Sample - Superstore');

      // All results should be from the specified data source
      for (const dim of dimensions) {
        expect(dim.dataSource).toBe('Sample - Superstore');
      }
      for (const measure of measures) {
        expect(measure.dataSource).toBe('Sample - Superstore');
      }
    });

    it('should have correct field structure', () => {
      const { dimensions } = getQueryableFields(context);

      const sampleDim = dimensions[0];
      expect(sampleDim).toHaveProperty('name');
      expect(sampleDim).toHaveProperty('internalName');
      expect(sampleDim).toHaveProperty('dataType');
      expect(sampleDim).toHaveProperty('dataSource');
      expect(sampleDim).toHaveProperty('isCalculated');
    });
  });

  describe('getWorksheetFields', () => {
    it('should return fields for existing worksheet', () => {
      const result = getWorksheetFields(context, 'Performance');

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('columns');
      expect(result).toHaveProperty('marks');
    });

    it('should return null for non-existent worksheet', () => {
      const result = getWorksheetFields(context, 'NonExistent');

      expect(result).toBeNull();
    });
  });
});

describe('Compact Index', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  describe('generateCompactIndex', () => {
    it('should generate a compact summary', () => {
      const index = generateCompactIndex(context);

      expect(index).toBeDefined();
      expect(typeof index).toBe('string');

      // Should be reasonably compact
      expect(index.length).toBeLessThan(3000); // ~3KB max
    });

    it('should include workbook name', () => {
      const index = generateCompactIndex(context);

      expect(index).toContain('WORKBOOK:');
      expect(index).toContain('Superstore');
    });

    it('should include data sources section', () => {
      const index = generateCompactIndex(context);

      expect(index).toContain('DATA SOURCES:');
      expect(index).toContain('Sample - Superstore');
    });

    it('should include dashboards section', () => {
      const index = generateCompactIndex(context);

      expect(index).toContain('DASHBOARDS:');
    });

    it('should include worksheets section', () => {
      const index = generateCompactIndex(context);

      expect(index).toContain('WORKSHEETS:');
    });

    it('should include parameters section', () => {
      const index = generateCompactIndex(context);

      expect(index).toContain('PARAMETERS:');
    });

    it('should include usage hint', () => {
      const index = generateCompactIndex(context);

      expect(index).toContain('query_workbook_context');
    });

    it('should show field and calculation counts', () => {
      const index = generateCompactIndex(context);

      // Should mention counts for data sources
      expect(index).toMatch(/\d+ fields/);
    });

    it('should show worksheet counts for dashboards', () => {
      const index = generateCompactIndex(context);

      // Should mention worksheet counts
      expect(index).toMatch(/\d+ worksheet/);
    });
  });
});
