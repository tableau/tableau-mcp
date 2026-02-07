/**
 * JQ Query Executor
 * 
 * Executes jq queries against WorkbookContext objects using jq-web,
 * a pure JavaScript/WASM implementation of jq.
 */

import type { WorkbookContext } from './types';

// jq-web instance cache
let jqInstance: any = null;
let jqInitPromise: Promise<any> | null = null;

/**
 * Get the jq instance, initializing it if necessary.
 * jq-web exports a function that returns a promise resolving to the jq module.
 */
async function getJq(): Promise<any> {
  if (jqInstance) {
    return jqInstance;
  }

  if (!jqInitPromise) {
    jqInitPromise = (async () => {
      try {
        // Use require for CommonJS compatibility
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const jqModule = require('jq-web');

        // jq-web exports a function that returns a promise
        // Await it to get the actual jq instance
        jqInstance = await jqModule;

        return jqInstance;
      } catch (error) {
        jqInitPromise = null; // Reset so it can be retried
        throw error;
      }
    })();
  }

  return jqInitPromise;
}

export interface JqQueryResult {
  success: boolean;
  data?: any;
  rawOutput?: string;
  error?: string;
}

/**
 * Execute a jq query against a WorkbookContext.
 * 
 * @param context The WorkbookContext to query
 * @param jqFilter The jq filter expression (e.g., ".dataSources[0].fields")
 * @returns The query result
 */
export async function executeJqQuery(
  context: WorkbookContext,
  jqFilter: string
): Promise<JqQueryResult> {
  try {
    const jq = await getJq();

    // Execute the jq filter against the context
    const result = jq.json(context, jqFilter);

    return {
      success: true,
      data: result,
      rawOutput: JSON.stringify(result),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Check if jq is available.
 * With jq-web, this returns true if the module can be loaded.
 */
export async function isJqAvailable(): Promise<boolean> {
  try {
    const jq = await getJq();
    // Verify it has the json function
    return typeof jq?.json === 'function';
  } catch {
    return false;
  }
}

/**
 * Common jq query patterns for workbook context.
 * These can be used as examples in tool descriptions.
 */
export const jqExamples = {
  // List data source names
  listDataSources: '.dataSources[] | .dataSourceName',

  // Get specific data source
  getDataSource: '.dataSources[] | select(.dataSourceName == "NAME")',

  // List fields for a data source
  listFields: '.dataSources[] | select(.dataSourceName == "NAME") | .fields[] | {name: .fieldName, caption: .fieldCaption, type: .dataType}',

  // Get visible fields only
  visibleFields: '.dataSources[] | select(.dataSourceName == "NAME") | .fields[] | select(.isHidden == false)',

  // List all calculations with formulas
  calculations: '.dataSources[] | .calculations[] | {name: .name, formula: .formula}',

  // List worksheet names
  worksheets: '.worksheets[] | .worksheetName',

  // Get worksheet details
  worksheetDetails: '.worksheets[] | select(.worksheetName == "NAME") | {name: .worksheetName, mark: .visualSpec.markType, rows: .visualSpec.fieldsOnRows, cols: .visualSpec.fieldsOnColumns}',

  // List dashboards with their worksheets
  dashboards: '.dashboards[] | {name: .dashboardName, sheets: .worksheetRefs}',

  // Get parameters
  parameters: '.parameters[] | {name: .name, type: .dataType, value: .currentValue}',

  // Count fields by data source
  fieldCounts: '.dataSources[] | {name: .dataSourceName, fieldCount: (.fields | length)}',
};
