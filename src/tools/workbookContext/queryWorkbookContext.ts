/**
 * Query Workbook Context Tool
 * 
 * MCP tool that allows agents to query workbook context using jq.
 * This provides full jq flexibility for drilling into any part of the context.
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { executeJqQuery, jqExamples, type JqQueryResult } from '../../workbookContext/jqQuery.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { workbookContextStore } from './workbookContextStore.js';

const paramsSchema = {
  contextId: z.string().describe(
    'The ID of the loaded workbook context to query. Use the workbook name or ID from the compact index.'
  ),
  jqFilter: z.string().describe(
    `A jq filter expression to query the context. Examples:
- ".dataSources[] | .dataSourceName" - List data source names
- ".dataSources[] | select(.dataSourceName == \\"Sample - Superstore\\") | .fields[]" - Get fields
- ".worksheets[] | {name: .worksheetName, mark: .visualSpec.markType}" - Worksheet summaries
- ".parameters[] | {name: .name, value: .currentValue}" - Parameter values
- ".dataSources[] | .calculations[] | {name: .name, formula: .formula}" - All calculations

The context object has these top-level keys:
- dataSources[] - Each has: dataSourceName, fields[], calculations[], hierarchies[]
- worksheets[] - Each has: worksheetName, visualSpec, typeInCalculations[], sheetFilters
- dashboards[] - Each has: dashboardName, worksheetRefs[], filterActions[]
- parameters[] - Each has: name, dataType, currentValue, domainType
- requiredFilters - Has: dataSourceFilters[], applyToAllFilters[]`
  ),
};

type QueryError =
  | { type: 'context-not-found'; contextId: string; available: string[] }
  | { type: 'jq-error'; message: string }
  | { type: 'jq-not-installed' };

export const getQueryWorkbookContextTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'query-workbook-context',
    description: `
Query a loaded workbook context using jq filter expressions.

This tool executes jq queries against the full workbook metadata, giving you 
complete flexibility to extract exactly what you need.

**Common jq patterns:**

List data sources:
  .dataSources[] | .dataSourceName

Get fields from a data source:
  .dataSources[] | select(.dataSourceName == "NAME") | .fields[] | {name: .fieldName, type: .dataType}

Get visible fields only:
  .dataSources[] | .fields[] | select(.isHidden == false) | .fieldCaption

List all calculations:
  .dataSources[] | .calculations[] | {name: .name, formula: .formula}

Worksheet visual specs:
  .worksheets[] | {name: .worksheetName, mark: .visualSpec.markType}

Dashboard structure:
  .dashboards[] | {name: .dashboardName, sheets: .worksheetRefs}

**Tips:**
- Use select() to filter arrays
- Use {} to project specific fields
- Use | to chain operations
- String values need escaped quotes: select(.name == \\"Value\\")
    `.trim(),
    paramsSchema,
    annotations: {
      title: 'Query Workbook Context',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ contextId, jqFilter }, { requestId, authInfo }): Promise<CallToolResult> => {
      return await tool.logAndExecute<JqQueryResult, QueryError>({
        requestId,
        authInfo,
        args: { contextId, jqFilter },
        callback: async () => {
          // Get the context from the store
          const context = workbookContextStore.get(contextId);
          if (!context) {
            return new Err({
              type: 'context-not-found',
              contextId,
              available: workbookContextStore.list(),
            });
          }

          // Execute the jq query
          const result = await executeJqQuery(context, jqFilter);

          if (!result.success) {
            if (result.error?.includes('not installed')) {
              return new Err({ type: 'jq-not-installed' });
            }
            return new Err({ type: 'jq-error', message: result.error ?? 'Unknown jq error' });
          }

          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => {
          switch (error.type) {
            case 'context-not-found':
              if (error.available.length > 0) {
                return `Workbook context not found: ${error.contextId}. Available: ${error.available.join(', ')}`;
              }
              return `Workbook context not found: ${error.contextId}. No contexts loaded. Use load-workbook-context first.`;
            case 'jq-not-installed':
              return 'jq is not installed on this server. Please install jq to use context queries.';
            case 'jq-error':
              return `jq query error: ${error.message}`;
          }
        },
      });
    },
  });

  return tool;
};
