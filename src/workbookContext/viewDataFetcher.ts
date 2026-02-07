/**
 * View Data Fetcher
 * 
 * Utility to fetch view data from Tableau Server/Cloud and analyze it
 * to produce WorksheetFacts with data summaries.
 */

import { analyzeCsv, ColumnStats } from '../resources/csvAnalyzer.js';
import { storeCsv } from '../resources/csvStorage.js';
import { View } from '../sdks/tableau/types/view.js';
import {
  WorksheetContext,
  WorksheetFacts,
  WorksheetDataSummary,
  DimensionSummary,
  MeasureSummary,
} from './types.js';

/**
 * REST API interface for fetching view data
 */
export interface ViewDataRestApi {
  siteId: string;
  viewsMethods: {
    queryViewData: (args: { viewId: string; siteId: string }) => Promise<string>;
  };
}

/**
 * Result of fetching facts for a single worksheet
 */
export interface WorksheetFactsResult {
  worksheetName: string;
  viewId?: string;
  facts: WorksheetFacts;
  csvStorageId?: string;
}

/**
 * Options for fetching worksheet facts
 */
export interface FetchWorksheetFactsOptions {
  /** Specific worksheet names to fetch (default: all) */
  worksheetNames?: string[];
  /** Whether to store the full CSV data (default: true) */
  storeCsvData?: boolean;
  /** Workbook ID for CSV storage metadata */
  workbookId?: string;
}

/**
 * Fetches and analyzes view data for worksheets, producing WorksheetFacts.
 * 
 * @param worksheets - The worksheets from the context
 * @param views - The views from the workbook (from REST API)
 * @param restApi - REST API client for fetching view data
 * @param options - Optional configuration
 * @returns Array of results with facts for each worksheet
 */
export async function fetchWorksheetFacts(
  worksheets: WorksheetContext[],
  views: View[],
  restApi: ViewDataRestApi,
  options: FetchWorksheetFactsOptions = {}
): Promise<WorksheetFactsResult[]> {
  const { worksheetNames, storeCsvData = true, workbookId } = options;
  const now = new Date().toISOString();
  const results: WorksheetFactsResult[] = [];

  // Filter worksheets if specific names provided
  const targetWorksheets = worksheetNames
    ? worksheets.filter((ws) => worksheetNames.includes(ws.worksheetName))
    : worksheets;

  for (const worksheet of targetWorksheets) {
    // Find matching view by name
    const matchingView = findMatchingView(worksheet.worksheetName, views);

    if (!matchingView) {
      results.push({
        worksheetName: worksheet.worksheetName,
        facts: {
          fetchedAt: now,
          fetchError: `No matching view found for worksheet "${worksheet.worksheetName}"`,
        },
      });
      continue;
    }

    try {
      // Fetch view data as CSV
      const csvContent = await restApi.viewsMethods.queryViewData({
        viewId: matchingView.id,
        siteId: restApi.siteId,
      });

      // Store CSV if requested
      let csvStorageId: string | undefined;
      if (storeCsvData && workbookId) {
        const storedCsv = await storeCsv({
          content: csvContent,
          viewId: matchingView.id,
          viewName: matchingView.name,
          workbookId,
        });
        csvStorageId = storedCsv.id;
      }

      // Analyze the CSV
      const analysis = analyzeCsv(csvContent);

      // Convert to WorksheetDataSummary
      const dataSummary = convertToDataSummary(analysis.columns, analysis.rowCount, analysis.sampleRows);

      results.push({
        worksheetName: worksheet.worksheetName,
        viewId: matchingView.id,
        csvStorageId,
        facts: {
          viewId: matchingView.id,
          fetchedAt: now,
          dataSummary,
        },
      });
    } catch (error) {
      results.push({
        worksheetName: worksheet.worksheetName,
        viewId: matchingView.id,
        facts: {
          viewId: matchingView.id,
          fetchedAt: now,
          fetchError: error instanceof Error ? error.message : 'Failed to fetch view data',
        },
      });
    }
  }

  return results;
}

/**
 * Finds a matching view for a worksheet by name.
 * Tableau view names typically match worksheet names.
 */
function findMatchingView(worksheetName: string, views: View[]): View | undefined {
  // Exact match first
  const exactMatch = views.find((v) => v.name === worksheetName);
  if (exactMatch) return exactMatch;

  // Case-insensitive match
  const lowerName = worksheetName.toLowerCase();
  const caseInsensitiveMatch = views.find((v) => v.name.toLowerCase() === lowerName);
  if (caseInsensitiveMatch) return caseInsensitiveMatch;

  // Partial match (view name contains worksheet name or vice versa)
  const partialMatch = views.find(
    (v) =>
      v.name.toLowerCase().includes(lowerName) ||
      lowerName.includes(v.name.toLowerCase())
  );

  return partialMatch;
}

/**
 * Converts CSV analysis columns to WorksheetDataSummary format.
 */
function convertToDataSummary(
  columns: ColumnStats[],
  rowCount: number,
  sampleRows: Record<string, string>[]
): WorksheetDataSummary {
  const dimensions: DimensionSummary[] = columns
    .filter((c) => c.type === 'dimension')
    .map((c) => ({
      name: c.name,
      distinctCount: c.distinctCount,
      distinctValues: c.distinctValues,
      sampleValues: c.sampleValues,
    }));

  const measures: MeasureSummary[] = columns
    .filter((c) => c.type === 'measure' && c.numericStats)
    .map((c) => ({
      name: c.name,
      min: c.numericStats!.min,
      max: c.numericStats!.max,
      avg: c.numericStats!.avg,
      sum: c.numericStats!.sum,
    }));

  return {
    rowCount,
    columnCount: columns.length,
    dimensions,
    measures,
    sampleRows,
  };
}

/**
 * Applies fetched facts to worksheets in a context, mutating them in place.
 * 
 * @param worksheets - The worksheets to update
 * @param factsResults - The fetched facts results
 * @returns Count of worksheets updated
 */
export function applyFactsToWorksheets(
  worksheets: WorksheetContext[],
  factsResults: WorksheetFactsResult[]
): number {
  let updatedCount = 0;

  for (const result of factsResults) {
    const worksheet = worksheets.find((ws) => ws.worksheetName === result.worksheetName);
    if (worksheet) {
      worksheet.facts = result.facts;
      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Generates a summary of facts results for display.
 */
export function summarizeFactsResults(results: WorksheetFactsResult[]): {
  total: number;
  successful: number;
  failed: number;
  details: Array<{
    worksheetName: string;
    status: 'success' | 'error';
    rowCount?: number;
    dimensionCount?: number;
    measureCount?: number;
    error?: string;
  }>;
} {
  const successful = results.filter((r) => r.facts.dataSummary && !r.facts.fetchError);
  const failed = results.filter((r) => r.facts.fetchError);

  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    details: results.map((r) => {
      if (r.facts.dataSummary && !r.facts.fetchError) {
        return {
          worksheetName: r.worksheetName,
          status: 'success' as const,
          rowCount: r.facts.dataSummary.rowCount,
          dimensionCount: r.facts.dataSummary.dimensions.length,
          measureCount: r.facts.dataSummary.measures.length,
        };
      }
      return {
        worksheetName: r.worksheetName,
        status: 'error' as const,
        error: r.facts.fetchError,
      };
    }),
  };
}
