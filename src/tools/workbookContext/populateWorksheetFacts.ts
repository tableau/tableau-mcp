/**
 * Populate Worksheet Facts Tool
 * 
 * MCP tool that enriches an already-loaded workbook context with analytical
 * facts by fetching view data from Tableau Server/Cloud.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { generateCompactIndex } from '../../workbookContext/contextFormatter.js';
import {
  fetchWorksheetFacts,
  applyFactsToWorksheets,
  summarizeFactsResults,
} from '../../workbookContext/viewDataFetcher.js';
import { Tool } from '../tool.js';
import { workbookContextStore } from './workbookContextStore.js';

const paramsSchema = {
  contextId: z.string().describe('The ID of the loaded workbook context to enrich with facts'),
  worksheetNames: z
    .array(z.string())
    .optional()
    .describe('Specific worksheet names to populate facts for. If omitted, all worksheets are populated.'),
  workbookId: z
    .string()
    .optional()
    .describe(
      'Override workbook LUID for REST API calls. If omitted, uses serverWorkbookId from the context.'
    ),
};

interface PopulateResult {
  contextId: string;
  worksheetsPopulated: number;
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
  compactIndex: string;
}

type PopulateError =
  | { type: 'context-not-found'; contextId: string }
  | { type: 'no-workbook-id'; message: string }
  | { type: 'fetch-failed'; message: string };

export const getPopulateWorksheetFactsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'populate-worksheet-facts',
    description: `
Populate an already-loaded workbook context with analytical facts from view data.

USE THIS TOOL WHEN:
- You already have a workbook context loaded (via download-workbook-context or load-workbook-context)
- You want to add analytical facts to specific worksheets
- You skipped fetchViewData during initial download and want to add facts later

This tool:
1. Fetches the underlying data for each worksheet's view from Tableau Server/Cloud
2. Analyzes the data to compute summary statistics
3. Attaches facts to each worksheet in the stored context
4. Returns an updated compact index

Facts include:
- Row counts, column counts
- Dimension cardinalities and distinct values
- Measure statistics (min, max, avg, sum)
- Sample rows

You can optionally specify specific worksheetNames to populate, otherwise all worksheets are populated.
    `.trim(),
    paramsSchema,
    annotations: {
      title: 'Populate Worksheet Facts',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { contextId, worksheetNames, workbookId },
      { requestId, authInfo, signal }
    ): Promise<CallToolResult> => {
      const config = getConfig();

      return await tool.logAndExecute<PopulateResult, PopulateError>({
        requestId,
        authInfo,
        args: { contextId, worksheetNames, workbookId },
        callback: async () => {
          // Get the context from the store
          const context = workbookContextStore.get(contextId);
          if (!context) {
            return new Err({ type: 'context-not-found', contextId });
          }

          // Determine workbook ID for API calls
          const resolvedWorkbookId = workbookId || context.serverWorkbookId;
          if (!resolvedWorkbookId) {
            return new Err({
              type: 'no-workbook-id',
              message:
                'No workbook ID available. Either provide workbookId parameter or ensure the context was downloaded from server (has serverWorkbookId).',
            });
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
                // Get workbook views from the API
                const workbook = await restApi.workbooksMethods.getWorkbook({
                  workbookId: resolvedWorkbookId,
                  siteId: restApi.siteId,
                });
                const views = workbook.views?.view || [];

                if (views.length === 0) {
                  return {
                    contextId,
                    worksheetsPopulated: 0,
                    successful: 0,
                    failed: 0,
                    details: [],
                    compactIndex: generateCompactIndex(context),
                  };
                }

                // Fetch facts for worksheets
                const factsResults = await fetchWorksheetFacts(
                  context.worksheets,
                  views,
                  {
                    siteId: restApi.siteId,
                    viewsMethods: restApi.viewsMethods,
                  },
                  {
                    worksheetNames,
                    storeCsvData: true,
                    workbookId: resolvedWorkbookId,
                  }
                );

                // Apply facts to worksheets (mutates context in place)
                const updatedCount = applyFactsToWorksheets(context.worksheets, factsResults);

                // Update the stored context
                workbookContextStore.set(contextId, context);

                // Generate summary
                const summary = summarizeFactsResults(factsResults);

                // Generate updated compact index
                const compactIndex = generateCompactIndex(context);

                return {
                  contextId,
                  worksheetsPopulated: updatedCount,
                  successful: summary.successful,
                  failed: summary.failed,
                  details: summary.details,
                  compactIndex,
                };
              },
            });

            return new Ok(result);
          } catch (error) {
            return new Err({
              type: 'fetch-failed',
              message: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => {
          switch (error.type) {
            case 'context-not-found':
              return `Context not found: ${error.contextId}. Use download-workbook-context or load-workbook-context first.`;
            case 'no-workbook-id':
              return error.message;
            case 'fetch-failed':
              return `Failed to fetch view data: ${error.message}`;
          }
        },
      });
    },
  });

  return tool;
};
