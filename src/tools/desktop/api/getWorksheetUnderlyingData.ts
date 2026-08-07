import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetUnderlyingDataQuery } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().describe('Worksheet name/id.'),
  logicalTable: z.string().describe("A logical table id from the worksheet's logical tables list."),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  includeAllColumns: z
    .boolean()
    .optional()
    .describe('Include every column rather than only the columns the view references.'),
  columns: z.array(z.string()).optional().describe('Field names to restrict the returned columns.'),
};
const title = 'Get Worksheet Underlying Data';

export const getWorksheetUnderlyingDataTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetUnderlyingData = new DesktopTool({
    server,
    name: 'get-worksheet-underlying-data',
    title,
    description:
      'Read row-level underlying data for one logical table of a worksheet (use list-worksheet-logical-tables for ids).',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheet, logicalTable, maxRows, includeAllColumns, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getWorksheetUnderlyingData.logAndExecute({
        extra,
        args: { session, worksheet, logicalTable, maxRows, includeAllColumns, columns },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const worksheetResult = resolveItemByNameOrId(
                'Worksheet',
                worksheet,
                listResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) {
                return worksheetResult.error.toErr();
              }

              const query: WorksheetUnderlyingDataQuery = {
                maxRows: Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP),
                ...(includeAllColumns !== undefined ? { includeAllColumns } : {}),
                ...(columns && columns.length > 0 ? { columnsToIncludeByFieldName: columns } : {}),
              };

              return await read(
                'worksheet underlying data',
                async (executor, signal) =>
                  await executor.getWorksheetUnderlyingData(
                    worksheetResult.value.id,
                    logicalTable,
                    query,
                    signal,
                  ),
              );
            },
          });
        },
      });
    },
  });

  return getWorksheetUnderlyingData;
};
