/**
 * TWB Parser Tests
 * 
 * Tests for the Tableau workbook XML parser.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

import { parseTwbFile, parseTwbXml, type WorkbookContext } from './index';

const SUPERSTORE_TWB_PATH = path.resolve(__dirname, '../../twbs/Superstore_extracted/Superstore.twb');

describe('TWB Parser', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    // Check if the test file exists
    if (!fs.existsSync(SUPERSTORE_TWB_PATH)) {
      throw new Error(`Test TWB file not found: ${SUPERSTORE_TWB_PATH}`);
    }

    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  describe('Workbook-level extraction', () => {
    it('should extract workbook name', () => {
      expect(context.workbookName).toBe('Superstore_us');
    });

    it('should have source file', () => {
      expect(context.sourceFile).toBe('Superstore.twb');
    });
  });

  describe('Data source extraction', () => {
    it('should extract data sources (excluding Parameters)', () => {
      expect(context.dataSources.length).toBeGreaterThan(0);

      // Should not include the Parameters datasource
      const paramDs = context.dataSources.find(ds => ds.dataSourceName === 'Parameters');
      expect(paramDs).toBeUndefined();
    });

    it('should find the main Sample - Superstore data source', () => {
      const superstore = context.dataSources.find(ds =>
        ds.dataSourceName.includes('Superstore') || ds.caption?.includes('Superstore')
      );
      expect(superstore).toBeDefined();
    });

    it('should extract fields from data sources', () => {
      const superstore = context.dataSources.find(ds =>
        ds.dataSourceName.includes('Superstore') || ds.caption?.includes('Superstore')
      );

      expect(superstore?.fields.length).toBeGreaterThan(0);

      // Check for some expected fields
      const fieldNames = superstore?.fields.map(f => f.fieldName) || [];
      expect(fieldNames).toContain('Sales');
      expect(fieldNames).toContain('Profit');
      expect(fieldNames).toContain('Category');
    });

    it('should correctly identify hidden fields', () => {
      const superstore = context.dataSources.find(ds =>
        ds.dataSourceName.includes('Superstore') || ds.caption?.includes('Superstore')
      );

      const hiddenFields = superstore?.fields.filter(f => f.isHidden) || [];
      expect(hiddenFields.length).toBeGreaterThan(0);
    });

    it('should extract calculated fields', () => {
      const superstore = context.dataSources.find(ds =>
        ds.dataSourceName.includes('Superstore') || ds.caption?.includes('Superstore')
      );

      expect(superstore?.calculations.length).toBeGreaterThan(0);

      // Each calculation should have a formula
      for (const calc of superstore?.calculations || []) {
        expect(calc.formula).toBeDefined();
        expect(calc.formula.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Parameter extraction', () => {
    it('should extract parameters', () => {
      expect(context.parameters.length).toBeGreaterThan(0);
    });

    it('should have correct parameter properties', () => {
      for (const param of context.parameters) {
        expect(param.name).toBeDefined();
        expect(param.dataType).toBeDefined();
        expect(param.domainType).toMatch(/^(list|range|any)$/);
      }
    });

    it('should extract range parameters with min/max', () => {
      const rangeParams = context.parameters.filter(p => p.domainType === 'range');
      expect(rangeParams.length).toBeGreaterThan(0);

      for (const param of rangeParams) {
        // At least one of min or max should be defined for range params
        expect(param.rangeMin !== undefined || param.rangeMax !== undefined).toBe(true);
      }
    });
  });

  describe('Worksheet extraction', () => {
    it('should extract worksheets', () => {
      expect(context.worksheets.length).toBeGreaterThan(0);
    });

    it('should have worksheet names', () => {
      for (const ws of context.worksheets) {
        expect(ws.worksheetName).toBeDefined();
        expect(ws.worksheetName.length).toBeGreaterThan(0);
      }
    });

    it('should extract data source references', () => {
      // At least some worksheets should have data source refs
      const wsWithRefs = context.worksheets.filter(ws => ws.dataSourceRefs.length > 0);
      expect(wsWithRefs.length).toBeGreaterThan(0);
    });

    it('should extract visual spec with rows and columns', () => {
      // At least some worksheets should have fields on rows or columns
      const wsWithFields = context.worksheets.filter(ws =>
        ws.visualSpec.fieldsOnRows.length > 0 || ws.visualSpec.fieldsOnColumns.length > 0
      );
      expect(wsWithFields.length).toBeGreaterThan(0);
    });

    it('should extract filters', () => {
      // At least some worksheets should have filters
      const wsWithFilters = context.worksheets.filter(ws =>
        ws.sheetFilters.contextFilters.length > 0 || ws.sheetFilters.regularFilters.length > 0
      );
      expect(wsWithFilters.length).toBeGreaterThan(0);
    });

    it('should set currentState to null (headless mode)', () => {
      for (const ws of context.worksheets) {
        expect(ws.currentState).toBeNull();
      }
    });
  });

  describe('Dashboard extraction', () => {
    it('should extract dashboards', () => {
      expect(context.dashboards.length).toBeGreaterThan(0);
    });

    it('should have dashboard names', () => {
      for (const db of context.dashboards) {
        expect(db.dashboardName).toBeDefined();
        expect(db.dashboardName.length).toBeGreaterThan(0);
      }
    });

    it('should extract worksheet references', () => {
      // At least some dashboards should have worksheet refs
      const dbWithRefs = context.dashboards.filter(db => db.worksheetRefs.length > 0);
      expect(dbWithRefs.length).toBeGreaterThan(0);
    });

    it('should extract actions', () => {
      // At least some dashboards should have actions
      const dbWithActions = context.dashboards.filter(db =>
        db.filterActions.length > 0 || db.highlightActions.length > 0
      );
      expect(dbWithActions.length).toBeGreaterThan(0);
    });
  });

  describe('Required filters extraction', () => {
    it('should have required filters structure', () => {
      expect(context.requiredFilters).toBeDefined();
      expect(context.requiredFilters.dataSourceFilters).toBeDefined();
      expect(context.requiredFilters.applyToAllFilters).toBeDefined();
    });
  });

  describe('Field usage tracking', () => {
    it('should track which views use each field', () => {
      // Find a field that's used in views
      let foundUsedField = false;

      for (const ds of context.dataSources) {
        for (const field of ds.fields) {
          if (field.usedInViews.length > 0) {
            foundUsedField = true;
            // Verify the view names are valid worksheet names
            for (const viewName of field.usedInViews) {
              const ws = context.worksheets.find(w => w.worksheetName === viewName);
              expect(ws).toBeDefined();
            }
            break;
          }
        }
        if (foundUsedField) break;
      }

      expect(foundUsedField).toBe(true);
    });
  });

  describe('XML validation', () => {
    it('should throw error for invalid XML', () => {
      expect(() => parseTwbXml('<invalid><xml>')).toThrow();
    });

    it('should throw error for non-workbook XML', () => {
      expect(() => parseTwbXml('<?xml version="1.0"?><root></root>')).toThrow(/No workbook element/);
    });
  });

  describe('File handling', () => {
    it('should throw error for missing file', async () => {
      await expect(parseTwbFile('/nonexistent/path.twb')).rejects.toThrow(/not found/);
    });
  });
});

describe('Specific Superstore assertions', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  it('should find expected worksheets', () => {
    const worksheetNames = context.worksheets.map(ws => ws.worksheetName);

    // Check for some known worksheets in Superstore
    expect(worksheetNames).toContain('Performance');
    expect(worksheetNames).toContain('Sale Map');
    expect(worksheetNames).toContain('Forecast');
  });

  it('should find expected dashboards', () => {
    const dashboardNames = context.dashboards.map(db => db.dashboardName);

    // Check for known dashboards
    expect(dashboardNames).toContain('Overview');
    expect(dashboardNames).toContain('Product');
    expect(dashboardNames).toContain('Customers');
  });

  it('should find Commission Model dashboard with Sales Commission data source', () => {
    const commissionModel = context.dashboards.find(db => db.dashboardName === 'Commission Model');
    expect(commissionModel).toBeDefined();

    // The Commission worksheets should use the Sales Commission data source
    const commissionDs = context.dataSources.find(ds =>
      ds.caption?.includes('Commission') || ds.dataSourceName.includes('Commission')
    );
    expect(commissionDs).toBeDefined();
  });

  it('should extract parameters with correct types', () => {
    // Look for known parameters in Superstore
    const baseSalary = context.parameters.find(p =>
      p.caption?.includes('Base Salary') || p.name.includes('Base Salary')
    );
    expect(baseSalary).toBeDefined();
    expect(baseSalary?.dataType).toBe('integer');
    expect(baseSalary?.domainType).toBe('range');

    const sortBy = context.parameters.find(p =>
      p.caption?.includes('Sort by') || p.name.includes('Parameter 1 1')
    );
    expect(sortBy).toBeDefined();
    expect(sortBy?.domainType).toBe('list');
  });
});

describe('Output summary', () => {
  it('should produce a comprehensive context summary', async () => {
    const context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });

    console.log('\n=== Workbook Context Summary ===');
    console.log(`Workbook: ${context.workbookName}`);
    console.log(`Data Sources: ${context.dataSources.length}`);

    for (const ds of context.dataSources) {
      console.log(`  - ${ds.dataSourceName} (${ds.fields.length} fields, ${ds.calculations.length} calcs)`);
      const hiddenCount = ds.fields.filter(f => f.isHidden).length;
      console.log(`    Hidden: ${hiddenCount}, Visible: ${ds.fields.length - hiddenCount}`);
    }

    console.log(`Parameters: ${context.parameters.length}`);
    for (const param of context.parameters) {
      console.log(`  - ${param.caption || param.name} (${param.domainType})`);
    }

    console.log(`Worksheets: ${context.worksheets.length}`);
    console.log(`Dashboards: ${context.dashboards.length}`);

    for (const db of context.dashboards) {
      console.log(`  - ${db.dashboardName} (${db.worksheetRefs.length} sheets, ${db.filterActions.length + db.highlightActions.length} actions)`);
    }

    console.log(`Required Filters:`);
    console.log(`  - Data Source Filters: ${context.requiredFilters.dataSourceFilters.length}`);
    console.log(`  - Apply-to-All Filters: ${context.requiredFilters.applyToAllFilters.length}`);

    // This test always passes - it's for generating output
    expect(true).toBe(true);
  });
});
