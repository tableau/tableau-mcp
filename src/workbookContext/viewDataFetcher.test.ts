/**
 * View Data Fetcher Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  fetchWorksheetFacts,
  applyFactsToWorksheets,
  summarizeFactsResults,
  type ViewDataRestApi,
  type WorksheetFactsResult,
} from './viewDataFetcher';
import { WorksheetContext } from './types';
import { View } from '../sdks/tableau/types/view';

// Mock the csvAnalyzer
vi.mock('../resources/csvAnalyzer', () => ({
  analyzeCsv: vi.fn((content: string) => {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    return {
      rowCount: lines.length - 1,
      columnCount: headers.length,
      columns: headers.map((h) => ({
        name: h,
        type: h.toLowerCase().includes('amount') || h.toLowerCase().includes('sales') ? 'measure' : 'dimension',
        distinctCount: 5,
        sampleValues: ['val1', 'val2', 'val3'],
        numericStats: h.toLowerCase().includes('sales') ? { min: 100, max: 1000, avg: 500, sum: 5000 } : undefined,
      })),
      sampleRows: [{ [headers[0]]: 'row1' }],
    };
  }),
}));

// Mock the csvStorage
vi.mock('../resources/csvStorage', () => ({
  storeCsv: vi.fn(async () => ({
    id: 'mock-csv-id',
    filename: 'test.csv',
    filePath: '/tmp/test.csv',
  })),
}));

describe('viewDataFetcher', () => {
  const mockWorksheets: WorksheetContext[] = [
    {
      worksheetId: 'ws1',
      worksheetName: 'Sales Overview',
      dataSourceRefs: ['ds1'],
      visualSpec: { markType: 'bar', fieldsOnRows: [], fieldsOnColumns: [], marks: {} },
      typeInCalculations: [],
      sheetFilters: { contextFilters: [], regularFilters: [] },
      currentState: null,
    },
    {
      worksheetId: 'ws2',
      worksheetName: 'Customer Details',
      dataSourceRefs: ['ds1'],
      visualSpec: { markType: 'table', fieldsOnRows: [], fieldsOnColumns: [], marks: {} },
      typeInCalculations: [],
      sheetFilters: { contextFilters: [], regularFilters: [] },
      currentState: null,
    },
  ];

  const mockViews: View[] = [
    { id: 'view1', name: 'Sales Overview', contentUrl: 'sales-overview' },
    { id: 'view2', name: 'Customer Details', contentUrl: 'customer-details' },
  ];

  const createMockRestApi = (csvContent: string = 'Category,Sales\nElectronics,1000\nClothing,500'): ViewDataRestApi => ({
    siteId: 'test-site',
    viewsMethods: {
      queryViewData: vi.fn(async () => csvContent),
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchWorksheetFacts', () => {
    it('should fetch facts for all worksheets when no filter provided', async () => {
      const restApi = createMockRestApi();

      const results = await fetchWorksheetFacts(mockWorksheets, mockViews, restApi);

      expect(results).toHaveLength(2);
      expect(results[0].worksheetName).toBe('Sales Overview');
      expect(results[1].worksheetName).toBe('Customer Details');
      expect(restApi.viewsMethods.queryViewData).toHaveBeenCalledTimes(2);
    });

    it('should filter worksheets by name when worksheetNames provided', async () => {
      const restApi = createMockRestApi();

      const results = await fetchWorksheetFacts(mockWorksheets, mockViews, restApi, {
        worksheetNames: ['Sales Overview'],
      });

      expect(results).toHaveLength(1);
      expect(results[0].worksheetName).toBe('Sales Overview');
      expect(restApi.viewsMethods.queryViewData).toHaveBeenCalledTimes(1);
    });

    it('should populate dataSummary with analyzed data', async () => {
      const restApi = createMockRestApi('Category,Sales\nA,100\nB,200');

      const results = await fetchWorksheetFacts(mockWorksheets.slice(0, 1), mockViews.slice(0, 1), restApi);

      expect(results[0].facts.dataSummary).toBeDefined();
      expect(results[0].facts.dataSummary!.rowCount).toBe(2);
      expect(results[0].facts.dataSummary!.columnCount).toBe(2);
    });

    it('should record fetchError when view data fetch fails', async () => {
      const restApi: ViewDataRestApi = {
        siteId: 'test-site',
        viewsMethods: {
          queryViewData: vi.fn(async () => {
            throw new Error('Network error');
          }),
        },
      };

      const results = await fetchWorksheetFacts(mockWorksheets.slice(0, 1), mockViews.slice(0, 1), restApi);

      expect(results[0].facts.fetchError).toBe('Network error');
      expect(results[0].facts.dataSummary).toBeUndefined();
    });

    it('should record fetchError when no matching view found', async () => {
      const restApi = createMockRestApi();
      const worksheetWithNoView: WorksheetContext[] = [
        {
          worksheetId: 'ws-no-view',
          worksheetName: 'NonExistentSheet',
          dataSourceRefs: ['ds1'],
          visualSpec: { markType: 'bar', fieldsOnRows: [], fieldsOnColumns: [], marks: {} },
          typeInCalculations: [],
          sheetFilters: { contextFilters: [], regularFilters: [] },
          currentState: null,
        },
      ];

      const results = await fetchWorksheetFacts(worksheetWithNoView, mockViews, restApi);

      expect(results[0].facts.fetchError).toContain('No matching view found');
    });

    it('should include viewId in facts when successful', async () => {
      const restApi = createMockRestApi();

      const results = await fetchWorksheetFacts(mockWorksheets.slice(0, 1), mockViews.slice(0, 1), restApi);

      expect(results[0].viewId).toBe('view1');
      expect(results[0].facts.viewId).toBe('view1');
    });
  });

  describe('applyFactsToWorksheets', () => {
    it('should apply facts to matching worksheets', () => {
      const worksheets = [...mockWorksheets];
      const factsResults: WorksheetFactsResult[] = [
        {
          worksheetName: 'Sales Overview',
          viewId: 'view1',
          facts: {
            viewId: 'view1',
            fetchedAt: '2024-01-01T00:00:00Z',
            dataSummary: {
              rowCount: 10,
              columnCount: 2,
              dimensions: [{ name: 'Category', distinctCount: 5, sampleValues: ['A', 'B'] }],
              measures: [{ name: 'Sales', min: 100, max: 1000, avg: 500, sum: 5000 }],
              sampleRows: [],
            },
          },
        },
      ];

      const updatedCount = applyFactsToWorksheets(worksheets, factsResults);

      expect(updatedCount).toBe(1);
      expect(worksheets[0].facts).toBeDefined();
      expect(worksheets[0].facts!.viewId).toBe('view1');
      expect(worksheets[0].facts!.dataSummary!.rowCount).toBe(10);
    });

    it('should return count of updated worksheets', () => {
      const worksheets = [...mockWorksheets];
      const factsResults: WorksheetFactsResult[] = [
        {
          worksheetName: 'Sales Overview',
          viewId: 'view1',
          facts: { viewId: 'view1', fetchedAt: '2024-01-01T00:00:00Z' },
        },
        {
          worksheetName: 'Customer Details',
          viewId: 'view2',
          facts: { viewId: 'view2', fetchedAt: '2024-01-01T00:00:00Z' },
        },
      ];

      const updatedCount = applyFactsToWorksheets(worksheets, factsResults);

      expect(updatedCount).toBe(2);
    });
  });

  describe('summarizeFactsResults', () => {
    it('should summarize successful results', () => {
      const results: WorksheetFactsResult[] = [
        {
          worksheetName: 'Sheet1',
          facts: {
            fetchedAt: '2024-01-01T00:00:00Z',
            dataSummary: {
              rowCount: 100,
              columnCount: 5,
              dimensions: [{ name: 'D1', distinctCount: 10, sampleValues: [] }],
              measures: [{ name: 'M1', min: 0, max: 100, avg: 50, sum: 5000 }],
              sampleRows: [],
            },
          },
        },
      ];

      const summary = summarizeFactsResults(results);

      expect(summary.total).toBe(1);
      expect(summary.successful).toBe(1);
      expect(summary.failed).toBe(0);
      expect(summary.details[0].status).toBe('success');
      expect(summary.details[0].rowCount).toBe(100);
    });

    it('should summarize failed results', () => {
      const results: WorksheetFactsResult[] = [
        {
          worksheetName: 'Sheet1',
          facts: {
            fetchedAt: '2024-01-01T00:00:00Z',
            fetchError: 'Failed to fetch',
          },
        },
      ];

      const summary = summarizeFactsResults(results);

      expect(summary.total).toBe(1);
      expect(summary.successful).toBe(0);
      expect(summary.failed).toBe(1);
      expect(summary.details[0].status).toBe('error');
      expect(summary.details[0].error).toBe('Failed to fetch');
    });

    it('should summarize mixed results', () => {
      const results: WorksheetFactsResult[] = [
        {
          worksheetName: 'Sheet1',
          facts: {
            fetchedAt: '2024-01-01T00:00:00Z',
            dataSummary: {
              rowCount: 50,
              columnCount: 3,
              dimensions: [],
              measures: [],
              sampleRows: [],
            },
          },
        },
        {
          worksheetName: 'Sheet2',
          facts: {
            fetchedAt: '2024-01-01T00:00:00Z',
            fetchError: 'Error',
          },
        },
      ];

      const summary = summarizeFactsResults(results);

      expect(summary.total).toBe(2);
      expect(summary.successful).toBe(1);
      expect(summary.failed).toBe(1);
    });
  });
});
