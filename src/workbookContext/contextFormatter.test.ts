/**
 * Context Formatter Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';

import {
  parseTwbFile,
  generateContextSummary,
  generateDataSourceSummary,
  generateRequiredFiltersSummary,
  generateDashboardFocusedContext,
  generateHbiQueryContext,
  generateCompactIndex,
  type WorkbookContext,
} from './index';

const SUPERSTORE_TWB_PATH = path.resolve(__dirname, '../../twbs/Superstore_extracted/Superstore.twb');

describe('Context Formatter', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  describe('generateContextSummary', () => {
    it('should generate markdown summary by default', () => {
      const summary = generateContextSummary(context);

      expect(summary).toContain('# Workbook:');
      expect(summary).toContain('## Data Sources');
      expect(summary).toContain('## Parameters');
      expect(summary).toContain('## Worksheets');
      expect(summary).toContain('## Dashboards');
    });

    it('should generate JSON summary', () => {
      const summary = generateContextSummary(context, { format: 'json' });

      // Should be valid JSON
      const parsed = JSON.parse(summary);
      expect(parsed.workbook).toBeDefined();
      expect(parsed.workbook.name).toBe('Superstore_us');
      expect(parsed.dataSources).toBeInstanceOf(Array);
      expect(parsed.parameters).toBeInstanceOf(Array);
    });

    it('should generate text summary', () => {
      const summary = generateContextSummary(context, { format: 'text' });

      expect(summary).toContain('WORKBOOK: Superstore_us');
      expect(summary).toContain('DATA SOURCES:');
      expect(summary).toContain('WORKSHEETS:');
      expect(summary).toContain('DASHBOARDS:');
    });

    it('should exclude hidden fields by default', () => {
      const summary = generateContextSummary(context, { format: 'json' });
      const parsed = JSON.parse(summary);

      // Find the Superstore data source
      const superstore = parsed.dataSources.find((ds: any) =>
        ds.name.includes('Superstore')
      );

      // No hidden fields should be in the output
      const hiddenFields = superstore?.fields?.filter((f: any) => f.isHidden) || [];
      expect(hiddenFields.length).toBe(0);
    });

    it('should include hidden fields when option is set', () => {
      const summary = generateContextSummary(context, {
        format: 'json',
        includeHiddenFields: true,
      });
      const parsed = JSON.parse(summary);

      // Find the Superstore data source
      const superstore = parsed.dataSources.find((ds: any) =>
        ds.name.includes('Superstore')
      );

      // Should have some hidden fields
      const hiddenFields = superstore?.fields?.filter((f: any) => f.isHidden) || [];
      expect(hiddenFields.length).toBeGreaterThan(0);
    });
  });

  describe('generateDataSourceSummary', () => {
    it('should focus on data sources and parameters', () => {
      const summary = generateDataSourceSummary(context);

      expect(summary).toContain('Sales Target');
      expect(summary).toContain('Sales Commission');
      expect(summary).toContain('Sample - Superstore');
      expect(summary).toContain('Parameters');
    });

    it('should include dimensions and measures sections', () => {
      const summary = generateDataSourceSummary(context);

      expect(summary).toContain('**Dimensions:**');
      expect(summary).toContain('**Measures:**');
    });
  });

  describe('generateRequiredFiltersSummary', () => {
    it('should generate required filters section', () => {
      const summary = generateRequiredFiltersSummary(context);

      expect(summary).toContain('## Required Filters');
    });
  });

  describe('generateDashboardFocusedContext', () => {
    it('should generate context for a specific dashboard', () => {
      const summary = generateDashboardFocusedContext(context, 'Overview');

      expect(summary).toContain('# Dashboard: Overview');
      expect(summary).toContain('## Worksheets in this Dashboard');
    });

    it('should return error message for non-existent dashboard', () => {
      const summary = generateDashboardFocusedContext(context, 'NonExistent');

      expect(summary).toContain('not found');
    });

    it('should include only data sources used by dashboard worksheets', () => {
      const overviewSummary = generateDashboardFocusedContext(context, 'Overview');
      const commissionSummary = generateDashboardFocusedContext(context, 'Commission Model');

      // Overview dashboard uses Sample - Superstore
      expect(overviewSummary).toContain('Superstore');

      // Commission Model dashboard uses Sales Commission
      expect(commissionSummary).toContain('Commission');
    });
  });

  describe('generateHbiQueryContext', () => {
    it('should generate minimal context for HBI queries', () => {
      const summary = generateHbiQueryContext(context);

      expect(summary).toContain('# Data Source:');
      expect(summary).toContain('## Dimensions');
      expect(summary).toContain('## Measures');
    });

    it('should filter to specific data source when provided', () => {
      const summary = generateHbiQueryContext(context, 'Sample - Superstore');

      expect(summary).toContain('Sample - Superstore');
      // Should NOT include other data sources as separate sections
      // (Note: field formulas may reference other data sources)
      expect(summary).not.toContain('# Data Source: Sales Target');
      expect(summary).not.toContain('# Data Source: Sales Commission');
    });

    it('should include calculated fields', () => {
      const summary = generateHbiQueryContext(context);

      expect(summary).toContain('## Calculated Fields');
    });

    it('should include parameters', () => {
      const summary = generateHbiQueryContext(context);

      expect(summary).toContain('# Parameters');
      expect(summary).toContain('Base Salary');
    });
  });
});

describe('generateCompactIndex', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  it('should generate a compact index for the workbook', () => {
    const index = generateCompactIndex(context);

    expect(index).toContain('WORKBOOK: Superstore_us');
    expect(index).toContain('DATA SOURCES:');
    expect(index).toContain('DASHBOARDS:');
    expect(index).toContain('WORKSHEETS:');
  });

  it('should show fact status when worksheets have facts', () => {
    // Create a copy and add facts to a worksheet
    const contextWithFacts = { ...context };
    contextWithFacts.worksheets = context.worksheets.map((ws, i) => {
      if (i === 0) {
        return {
          ...ws,
          facts: {
            viewId: 'test-view-1',
            fetchedAt: '2024-01-01T00:00:00Z',
            dataSummary: {
              rowCount: 150,
              columnCount: 5,
              dimensions: [
                { name: 'Category', distinctCount: 3, sampleValues: ['A', 'B', 'C'] },
                { name: 'Region', distinctCount: 4, sampleValues: ['N', 'S', 'E', 'W'] },
              ],
              measures: [
                { name: 'Sales', min: 0, max: 1000, avg: 500, sum: 75000 },
              ],
              sampleRows: [],
            },
          },
        };
      }
      return ws;
    });

    const index = generateCompactIndex(contextWithFacts);

    // Should indicate worksheets with facts (note: more than 1 failed if others have no facts)
    expect(index).toContain('1 with facts');
    // Should show fact details for the first worksheet
    expect(index).toContain('[facts: 150 rows, 2 dims, 1 measures]');
  });

  it('should show both success and failure counts', () => {
    // Create a copy with one success and one failure
    const contextMixed = { ...context };
    contextMixed.worksheets = context.worksheets.slice(0, 3).map((ws, i) => {
      if (i === 0) {
        return {
          ...ws,
          facts: {
            viewId: 'test-view-1',
            fetchedAt: '2024-01-01T00:00:00Z',
            dataSummary: {
              rowCount: 100,
              columnCount: 2,
              dimensions: [{ name: 'Cat', distinctCount: 3, sampleValues: [] }],
              measures: [],
              sampleRows: [],
            },
          },
        };
      }
      if (i === 1) {
        return {
          ...ws,
          facts: {
            fetchedAt: '2024-01-01T00:00:00Z',
            fetchError: 'No matching view found',
          },
        };
      }
      return ws;
    });

    const index = generateCompactIndex(contextMixed);

    // Should show both counts
    expect(index).toContain('1 with facts');
    expect(index).toContain('1 failed');
  });

  it('should show error indicator when facts have error', () => {
    // Create a copy with a fact error
    const contextWithFactError = { ...context };
    contextWithFactError.worksheets = context.worksheets.map((ws, i) => {
      if (i === 0) {
        return {
          ...ws,
          facts: {
            fetchedAt: '2024-01-01T00:00:00Z',
            fetchError: 'No matching view found',
          },
        };
      }
      return ws;
    });

    const index = generateCompactIndex(contextWithFactError);

    // Should show error indicator
    expect(index).toContain('[facts: error]');
  });

  it('should not show fact info for worksheets without facts', () => {
    const index = generateCompactIndex(context);

    // Original context has no facts, so no fact indicators should appear
    expect(index).not.toContain('[facts:');
    expect(index).not.toContain('with facts');
  });
});

describe('Output examples', () => {
  let context: WorkbookContext;

  beforeAll(async () => {
    context = await parseTwbFile(SUPERSTORE_TWB_PATH, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });
  });

  it('should produce readable markdown summary', () => {
    const summary = generateContextSummary(context, {
      includeWorksheets: false,
      includeDashboards: true,
    });

    console.log('\n=== MARKDOWN SUMMARY (truncated) ===');
    console.log(summary.substring(0, 2000));
    console.log('...');

    expect(summary.length).toBeGreaterThan(0);
  });

  it('should produce compact HBI query context', () => {
    const summary = generateHbiQueryContext(context, 'Sample - Superstore');

    console.log('\n=== HBI QUERY CONTEXT ===');
    console.log(summary);

    expect(summary.length).toBeGreaterThan(0);
  });
});
