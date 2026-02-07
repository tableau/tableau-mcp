/**
 * Load Workbook Context Tool
 * 
 * MCP tool that parses a Tableau workbook file (TWB) and loads its
 * context into the store for subsequent querying.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { parseTwbFile } from '../../workbookContext/twbParser.js';
import { generateCompactIndex } from '../../workbookContext/contextFormatter.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { workbookContextStore } from './workbookContextStore.js';

const paramsSchema = {
  twbPath: z.string().describe(
    'The file path to the Tableau workbook (.twb) file to load'
  ),
  contextId: z.string().optional().describe(
    'Optional custom ID for the loaded context. Defaults to the workbook name.'
  ),
};

interface LoadResult {
  contextId: string;
  workbookName: string;
  compactIndex: string;
  stats: {
    dataSources: number;
    worksheets: number;
    dashboards: number;
    parameters: number;
  };
}

type LoadError =
  | { type: 'file-not-found'; path: string }
  | { type: 'parse-error'; message: string };

export const getLoadWorkbookContextTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'load-workbook-context',
    description: `
Load a Tableau workbook (.twb) file FROM THE LOCAL FILESYSTEM and extract its context for querying.

USE THIS TOOL WHEN:
- You have a .twb file already on disk (local development, testing, or offline analysis)
- You have extracted a .twb from a .twbx archive manually
- You don't have Tableau Server/Cloud credentials or access

USE "download-workbook-context" INSTEAD WHEN:
- You want to analyze a published workbook on Tableau Server/Cloud
- You have a Tableau URL or workbook LUID

This tool parses a workbook file and:
1. Extracts all metadata (data sources, fields, calculations, worksheets, etc.)
2. Stores the context for subsequent queries
3. Returns a compact index for the agent to use

After loading, use "query-workbook-context" to drill into specific details.

The compact index returned provides an overview of:
- Data sources and their field counts
- Dashboards and worksheets
- Parameters
- Required filters
    `.trim(),
    paramsSchema,
    annotations: {
      title: 'Load Workbook Context',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ twbPath, contextId }, { requestId, authInfo }): Promise<CallToolResult> => {
      return await tool.logAndExecute<LoadResult, LoadError>({
        requestId,
        authInfo,
        args: { twbPath, contextId },
        callback: async () => {
          try {
            // Parse the TWB file
            const context = await parseTwbFile(twbPath, {
              includeFilterDetails: true,
              includeMarksDetails: true,
              includeActions: true,
            });

            // Generate context ID from workbook name if not provided
            const id = contextId || context.workbookName;

            // Store the context
            workbookContextStore.set(id, context);

            // Generate compact index
            const compactIndex = generateCompactIndex(context);

            return new Ok({
              contextId: id,
              workbookName: context.workbookName,
              compactIndex,
              stats: {
                dataSources: context.dataSources.length,
                worksheets: context.worksheets.length,
                dashboards: context.dashboards.length,
                parameters: context.parameters.length,
              },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes('ENOENT') || message.includes('no such file')) {
              return new Err({ type: 'file-not-found', path: twbPath });
            }

            return new Err({ type: 'parse-error', message });
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => {
          if (error.type === 'file-not-found') {
            return `File not found: ${error.path}`;
          }
          return `Failed to parse workbook: ${error.message}`;
        },
      });
    },
  });

  return tool;
};
