/**
 * Workbook Context Module
 * 
 * Provides utilities for extracting agent-relevant metadata from Tableau workbooks.
 * This is a core component of the Analytics Agent Harness.
 * 
 * @example
 * ```typescript
 * import { 
 *   parseTwbFile, 
 *   generateContextSummary,
 *   WorkbookContext 
 * } from './workbookContext';
 * 
 * // Parse the workbook
 * const context = await parseTwbFile('./path/to/workbook.twb', {
 *   includeFilterDetails: true,
 *   includeMarksDetails: true,
 *   includeActions: true,
 * });
 * 
 * // Generate an agent-friendly summary
 * const summary = generateContextSummary(context, {
 *   format: 'markdown',
 *   includeHiddenFields: false,
 * });
 * 
 * console.log(summary);
 * ```
 */

// Export all types
export * from './types';

// Export parser functions
export {
  parseTwbFile,
  parseTwbXml,
  type ParseTwbOptions,
} from './twbParser';

// Export formatter functions
export {
  generateContextSummary,
  generateDataSourceSummary,
  generateRequiredFiltersSummary,
  generateAnalystGuidanceSummary,
  generateDashboardFocusedContext,
  generateHbiQueryContext,
  generateCompactIndex,
  type ContextSummaryOptions,
} from './contextFormatter';

// Export context query functions (structured queries)
export {
  queryContext,
  getQueryableFields,
  getWorksheetFields,
  type QueryPath,
  type ContextQueryOptions,
  type QueryResult,
} from './contextQuery';

// Export jq query functions
export {
  executeJqQuery,
  isJqAvailable,
  jqExamples,
  type JqQueryResult,
} from './jqQuery';

// Export TWBX extraction functions
export {
  extractTwbFromTwbx,
  extractTwbFromTwbxFile,
  isExtractionError,
  type TwbxContents,
  type TwbxExtractionError,
} from './twbxExtractor';

// Export view data fetcher functions
export {
  fetchWorksheetFacts,
  applyFactsToWorksheets,
  summarizeFactsResults,
  type ViewDataRestApi,
  type WorksheetFactsResult,
  type FetchWorksheetFactsOptions,
} from './viewDataFetcher';

// Export utility functions (for testing and advanced use)
export {
  ensureArray,
  cleanFieldName,
  cleanStringValue,
  mapDataType,
} from './twbParser';
