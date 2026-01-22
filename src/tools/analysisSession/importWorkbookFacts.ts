import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { DataSummary, Fact, ViewEvidence } from '../../resources/analysisSession.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { analyzeCsv, CsvAnalysis } from '../../resources/csvAnalyzer.js';
import { storeCsv } from '../../resources/csvStorage.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { View } from '../../sdks/tableau/types/view.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  sessionId: z.string().uuid(),
  workbookId: z.string().describe('The workbook ID to import facts from'),
  viewIds: z
    .array(z.string())
    .optional()
    .describe('Specific view IDs to import. If omitted, all views are imported.'),
  fetchViewData: z
    .boolean()
    .default(true)
    .describe('If true, fetch and analyze the actual data from each view (recommended)'),
};

type ImportError =
  | { type: 'session-not-found'; sessionId: string }
  | { type: 'workbook-fetch-failed'; workbookId: string; message: string };

// Enhanced result type with data summaries for each view
type ViewFactResult = {
  factId: string;
  viewId: string;
  viewName: string;
  dataSummary?: {
    rowCount: number;
    columnCount: number;
    dimensions: Array<{ name: string; distinctCount: number; sampleValues: string[] }>;
    measures: Array<{
      name: string;
      min: number;
      max: number;
      avg: number;
    }>;
  };
  dataFetchError?: string;
};

type ImportResult = {
  message: string;
  workbookId: string;
  workbookName: string;
  factsImported: ViewFactResult[];
  totalSessionFacts: number;
  hint: string;
};

export const getImportWorkbookFactsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'import-workbook-facts',
    description: `
Imports analytical facts from a Tableau workbook's views, including the actual data.

For each view, this tool:
1. Fetches the view's underlying data (CSV export)
2. Analyzes the data to compute summary statistics (row counts, value ranges, distinct values)
3. Stores the full data on the server (referenced by ID)
4. Creates a fact with the data summary as verifiable evidence

The returned data summaries include:
- Row and column counts
- For dimensions: distinct values and cardinality
- For measures: min, max, and average values
- Sample rows from the data

YOU (the MCP client) should generate natural language claims based on the structured data summaries.
The evidence is verifiable - you can cite specific values from the data.

Imported facts have confidence level 'curated' with verifiable data evidence.
    `.trim(),
    paramsSchema,
    annotations: {
      title: 'Import Workbook Facts',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { sessionId, workbookId, viewIds, fetchViewData },
      { requestId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await tool.logAndExecute<ImportResult, ImportError>({
        requestId,
        authInfo,
        args: { sessionId, workbookId, viewIds, fetchViewData },
        callback: async () => {
          const session = analysisSessionStore.getIfValid(sessionId);
          if (!session) {
            return new Err({ type: 'session-not-found', sessionId });
          }

          try {
            const result = await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:content:read', 'tableau:views:download'],
              signal,
              authInfo: getTableauAuthInfo(authInfo),
              callback: async (restApi) => {
                const workbook = await restApi.workbooksMethods.getWorkbook({
                  workbookId,
                  siteId: restApi.siteId,
                });

                const views = workbook.views?.view || [];

                // Filter to specific views if requested
                const viewsToImport = viewIds?.length
                  ? views.filter((v) => viewIds.includes(v.id))
                  : views;

                const importedFacts: ViewFactResult[] = [];
                const now = new Date().toISOString();

                for (const view of viewsToImport) {
                  const factResult = await importViewAsFact({
                    view,
                    workbook: { id: workbook.id, name: workbook.name },
                    fetchViewData,
                    restApi,
                    now,
                    session,
                  });

                  importedFacts.push(factResult);
                }

                // Update workbook metadata in scope
                const scopeWorkbook = session.scope.workbooks.find(
                  (w) => w.workbookId === workbookId,
                );
                if (scopeWorkbook) {
                  scopeWorkbook.workbookName = workbook.name;
                  scopeWorkbook.viewIds = viewsToImport.map((v) => v.id);
                } else {
                  session.scope.workbooks.push({
                    workbookId: workbook.id,
                    workbookName: workbook.name,
                    viewIds: viewsToImport.map((v) => v.id),
                  });
                }

                analysisSessionStore.touch(sessionId);

                const successCount = importedFacts.filter((f) => f.dataSummary).length;
                const failCount = importedFacts.filter((f) => f.dataFetchError).length;

                let message = `Imported ${importedFacts.length} facts from workbook "${workbook.name}"`;
                if (fetchViewData) {
                  message += `. Data fetched for ${successCount} views`;
                  if (failCount > 0) {
                    message += ` (${failCount} failed)`;
                  }
                }

                return {
                  message,
                  workbookId: workbook.id,
                  workbookName: workbook.name,
                  factsImported: importedFacts,
                  totalSessionFacts: session.factStore.length,
                  hint: 'Generate natural language claims based on the data summaries. Cite specific values as evidence.',
                };
              },
            });

            return new Ok(result);
          } catch (error) {
            return new Err({
              type: 'workbook-fetch-failed',
              workbookId,
              message: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => {
          switch (error.type) {
            case 'session-not-found':
              return `Analysis session not found: ${error.sessionId}`;
            case 'workbook-fetch-failed':
              return `Failed to fetch workbook ${error.workbookId}: ${error.message}`;
          }
        },
      });
    },
  });

  return tool;
};

/**
 * Import a single view as a fact, optionally fetching and analyzing its data
 */
async function importViewAsFact(params: {
  view: View;
  workbook: { id: string; name: string };
  fetchViewData: boolean;
  restApi: {
    siteId: string;
    viewsMethods: { queryViewData: (args: { viewId: string; siteId: string }) => Promise<string> };
  };
  now: string;
  session: { factStore: Fact[] };
}): Promise<ViewFactResult> {
  const { view, workbook, fetchViewData, restApi, now, session } = params;

  let dataSummary: DataSummary | undefined;
  let dataFetchError: string | undefined;
  let csvAnalysis: CsvAnalysis | undefined;

  // Fetch and analyze view data if requested
  if (fetchViewData) {
    try {
      const csvContent = await restApi.viewsMethods.queryViewData({
        viewId: view.id,
        siteId: restApi.siteId,
      });

      // Store the full CSV
      const storedCsv = await storeCsv({
        content: csvContent,
        viewId: view.id,
        viewName: view.name,
        workbookId: workbook.id,
      });

      // Analyze the CSV
      csvAnalysis = analyzeCsv(csvContent);

      // Build the data summary for the evidence
      dataSummary = {
        rowCount: csvAnalysis.rowCount,
        columnCount: csvAnalysis.columnCount,
        columns: csvAnalysis.columns,
        sampleRows: csvAnalysis.sampleRows,
        storageId: storedCsv.id,
      };
    } catch (error) {
      dataFetchError = error instanceof Error ? error.message : 'Failed to fetch view data';
    }
  }

  // Create the evidence object
  const evidence: ViewEvidence = {
    type: 'view',
    workbookId: workbook.id,
    workbookName: workbook.name,
    viewId: view.id,
    viewName: view.name,
    viewDescription: undefined,
    datasourceLuids: [],
    importedAt: now,
    dataSummary,
    dataFetchError,
  };

  // Create the fact (claim will be generated by the MCP client based on data)
  const fact: Fact = {
    id: randomUUID(),
    claim: `View: ${view.name}`, // Placeholder - client should generate based on data
    evidence,
    confidence: dataSummary ? 'verified' : 'curated',
  };

  session.factStore.push(fact);

  // Build the result for the client
  const factResult: ViewFactResult = {
    factId: fact.id,
    viewId: view.id,
    viewName: view.name,
  };

  if (dataSummary && csvAnalysis) {
    // Provide structured summary for the client to generate claims
    factResult.dataSummary = {
      rowCount: csvAnalysis.rowCount,
      columnCount: csvAnalysis.columnCount,
      dimensions: csvAnalysis.columns
        .filter((c) => c.type === 'dimension')
        .map((c) => ({
          name: c.name,
          distinctCount: c.distinctCount,
          sampleValues: c.distinctValues || c.sampleValues,
        })),
      measures: csvAnalysis.columns
        .filter((c) => c.type === 'measure' && c.numericStats)
        .map((c) => ({
          name: c.name,
          min: c.numericStats!.min,
          max: c.numericStats!.max,
          avg: c.numericStats!.avg,
        })),
    };
  }

  if (dataFetchError) {
    factResult.dataFetchError = dataFetchError;
  }

  return factResult;
}
