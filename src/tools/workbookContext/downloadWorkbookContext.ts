/**
 * Download Workbook Context Tool
 * 
 * MCP tool that downloads a workbook from Tableau Server/Cloud,
 * extracts the TWB from the TWBX, parses it, and loads the context
 * into the store for subsequent querying.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { storeTwbx } from '../../resources/twbxStorage.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import {
  parseWorkbookUrl,
  isWorkbookUrlParseError,
  buildWorkbookContentUrlFilter,
} from '../../utils/parseWorkbookUrl.js';
import { parseTwbXml } from '../../workbookContext/twbParser.js';
import { generateCompactIndex } from '../../workbookContext/contextFormatter.js';
import { extractTwbFromTwbx, isExtractionError } from '../../workbookContext/twbxExtractor.js';
import {
  fetchWorksheetFacts,
  applyFactsToWorksheets,
  summarizeFactsResults,
} from '../../workbookContext/viewDataFetcher.js';
import { Tool } from '../tool.js';
import { workbookContextStore } from './workbookContextStore.js';

const paramsSchema = {
  workbookUrl: z
    .string()
    .optional()
    .describe(
      'Full Tableau URL to the workbook (e.g., https://tableau.company.com/#/views/Superstore/Overview)'
    ),
  workbookId: z
    .string()
    .optional()
    .describe('Direct workbook LUID (if known). Either workbookUrl or workbookId must be provided.'),
  contextId: z
    .string()
    .optional()
    .describe('Optional custom ID for the loaded context. Defaults to the workbook name.'),
  fetchViewData: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, also fetch data from each view and compute summary statistics (row counts, dimension cardinalities, measure stats). This adds analytical facts to each worksheet.'
    ),
};

interface DownloadResult {
  contextId: string;
  workbookId: string;
  workbookName: string;
  compactIndex: string;
  twbxStorageId: string;
  stats: {
    dataSources: number;
    worksheets: number;
    dashboards: number;
    parameters: number;
    twbxFileSize: number;
  };
  /** Facts summary (only present if fetchViewData was true) */
  factsSummary?: {
    total: number;
    successful: number;
    failed: number;
  };
}

type DownloadError =
  | { type: 'missing-params'; message: string }
  | { type: 'invalid-url'; message: string }
  | { type: 'workbook-not-found'; workbookContentUrl: string }
  | { type: 'download-failed'; workbookId: string; message: string }
  | { type: 'extraction-failed'; message: string }
  | { type: 'parse-error'; message: string };

export const getDownloadWorkbookContextTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'download-workbook-context',
    description: `
Download a workbook from Tableau Server/Cloud and extract its context for querying.

USE THIS TOOL WHEN:
- You want to analyze a PUBLISHED workbook on Tableau Server/Cloud
- You have a Tableau URL (e.g., from a browser) or workbook LUID
- You have valid Tableau credentials configured

USE "load-workbook-context" INSTEAD WHEN:
- You already have a .twb file on the local filesystem
- You're doing local development/testing with extracted workbooks
- You don't have Tableau Server/Cloud access

This tool:
1. Downloads the workbook as a TWBX file via REST API
2. Extracts the TWB (workbook definition) from the TWBX archive
3. Parses the TWB to extract all metadata (data sources, fields, calculations, worksheets, etc.)
4. Stores both the TWBX file and parsed context locally
5. Optionally fetches view data and computes analytical facts (if fetchViewData=true)
6. Returns a compact index for the agent to use

Set fetchViewData=true to also fetch data from each view and compute:
- Row counts, column counts
- Dimension cardinalities and distinct values
- Measure statistics (min, max, avg, sum)
- Sample rows

You can provide either:
- A full Tableau URL (workbookUrl): https://tableau.company.com/#/views/Superstore/Overview
- A direct workbook LUID (workbookId): abc123-def456

After loading, use "query-workbook-context" with jq filters to drill into specific details.

The compact index returned provides an overview of:
- Data sources and their field counts
- Dashboards and worksheets
- Parameters
- Required filters
    `.trim(),
    paramsSchema,
    annotations: {
      title: 'Download Workbook Context',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookUrl, workbookId, contextId, fetchViewData },
      { requestId, authInfo, signal }
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await tool.logAndExecute<DownloadResult, DownloadError>({
        requestId,
        authInfo,
        args: { workbookUrl, workbookId, contextId, fetchViewData },
        callback: async () => {
          // Validate that at least one identifier is provided
          if (!workbookUrl && !workbookId) {
            return new Err({
              type: 'missing-params',
              message: 'Either workbookUrl or workbookId must be provided',
            });
          }

          try {
            const result = await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: fetchViewData
                ? ['tableau:content:read', 'tableau:views:download']
                : ['tableau:content:read'],
              signal,
              authInfo: getTableauAuthInfo(authInfo),
              callback: async (restApi) => {
                let resolvedWorkbookId = workbookId;
                let workbookName = '';

                // If URL provided, parse it and find the workbook
                if (workbookUrl && !resolvedWorkbookId) {
                  const parsed = parseWorkbookUrl(workbookUrl);

                  if (isWorkbookUrlParseError(parsed)) {
                    throw { errorType: 'invalid-url', message: parsed.message };
                  }

                  // Query for the workbook by content URL
                  const filter = buildWorkbookContentUrlFilter(parsed.workbookContentUrl);
                  const { workbooks } = await restApi.workbooksMethods.queryWorkbooksForSite({
                    siteId: restApi.siteId,
                    filter,
                  });

                  if (workbooks.length === 0) {
                    throw {
                      errorType: 'workbook-not-found',
                      workbookContentUrl: parsed.workbookContentUrl,
                    };
                  }

                  resolvedWorkbookId = workbooks[0].id;
                  workbookName = workbooks[0].name;
                }

                // If we still don't have a workbook name, fetch it
                if (!workbookName && resolvedWorkbookId) {
                  const workbook = await restApi.workbooksMethods.getWorkbook({
                    workbookId: resolvedWorkbookId,
                    siteId: restApi.siteId,
                  });
                  workbookName = workbook.name;
                }

                // Download the workbook as TWBX
                const twbxBuffer = await restApi.workbooksMethods.downloadWorkbook({
                  workbookId: resolvedWorkbookId!,
                  siteId: restApi.siteId,
                });

                // Store the TWBX file
                const twbxMetadata = await storeTwbx({
                  content: twbxBuffer,
                  workbookId: resolvedWorkbookId!,
                  workbookName,
                });

                // Extract the TWB from the TWBX
                const extraction = extractTwbFromTwbx(twbxBuffer);

                if (isExtractionError(extraction)) {
                  throw { errorType: 'extraction-failed', message: extraction.message };
                }

                // Parse the TWB XML
                const context = parseTwbXml(extraction.twbXml, extraction.twbFilename, {
                  includeFilterDetails: true,
                  includeMarksDetails: true,
                  includeActions: true,
                });

                // Store the server workbook ID for subsequent API calls
                context.serverWorkbookId = resolvedWorkbookId;

                // Generate context ID from workbook name if not provided
                const id = contextId || context.workbookName;

                // Optionally fetch view data and compute facts
                let factsSummary: { total: number; successful: number; failed: number } | undefined;
                if (fetchViewData) {
                  // Get workbook views from the API
                  const workbook = await restApi.workbooksMethods.getWorkbook({
                    workbookId: resolvedWorkbookId!,
                    siteId: restApi.siteId,
                  });
                  const views = workbook.views?.view || [];

                  if (views.length > 0) {
                    // Fetch facts for all worksheets
                    const factsResults = await fetchWorksheetFacts(
                      context.worksheets,
                      views,
                      {
                        siteId: restApi.siteId,
                        viewsMethods: restApi.viewsMethods,
                      },
                      {
                        storeCsvData: true,
                        workbookId: resolvedWorkbookId,
                      }
                    );

                    // Apply facts to worksheets
                    applyFactsToWorksheets(context.worksheets, factsResults);

                    // Generate summary
                    const summary = summarizeFactsResults(factsResults);
                    factsSummary = {
                      total: summary.total,
                      successful: summary.successful,
                      failed: summary.failed,
                    };
                  }
                }

                // Store the context
                workbookContextStore.set(id, context);

                // Generate compact index
                const compactIndex = generateCompactIndex(context);

                return {
                  contextId: id,
                  workbookId: resolvedWorkbookId!,
                  workbookName: context.workbookName,
                  compactIndex,
                  twbxStorageId: twbxMetadata.id,
                  stats: {
                    dataSources: context.dataSources.length,
                    worksheets: context.worksheets.length,
                    dashboards: context.dashboards.length,
                    parameters: context.parameters.length,
                    twbxFileSize: twbxMetadata.fileSize,
                  },
                  factsSummary,
                };
              },
            });

            return new Ok(result);
          } catch (error: any) {
            // Handle typed errors from the callback
            if (error.errorType === 'invalid-url') {
              return new Err({ type: 'invalid-url', message: error.message });
            }
            if (error.errorType === 'workbook-not-found') {
              return new Err({
                type: 'workbook-not-found',
                workbookContentUrl: error.workbookContentUrl,
              });
            }
            if (error.errorType === 'extraction-failed') {
              return new Err({ type: 'extraction-failed', message: error.message });
            }

            const message = error instanceof Error ? error.message : String(error);

            if (message.includes('download')) {
              return new Err({
                type: 'download-failed',
                workbookId: workbookId || 'unknown',
                message,
              });
            }

            return new Err({ type: 'parse-error', message });
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => {
          switch (error.type) {
            case 'missing-params':
              return error.message;
            case 'invalid-url':
              return `Invalid URL: ${error.message}`;
            case 'workbook-not-found':
              return `Workbook not found: ${error.workbookContentUrl}`;
            case 'download-failed':
              return `Failed to download workbook ${error.workbookId}: ${error.message}`;
            case 'extraction-failed':
              return `Failed to extract TWB from TWBX: ${error.message}`;
            case 'parse-error':
              return `Failed to parse workbook: ${error.message}`;
          }
        },
      });
    },
  });

  return tool;
};
