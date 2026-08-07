import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetUnderlyingDataQuery } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { qualifyColumnFields } from './qualifyColumnField.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().describe('Worksheet name/id.'),
  logicalTable: z
    .string()
    .describe("A logical table caption or id from the worksheet's logical tables."),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  includeAllColumns: z
    .boolean()
    .optional()
    .describe('Include every column, not only the ones the view references.'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Field names to restrict the columns (e.g. "Region").'),
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
      "Read row-level underlying data for one of a worksheet's logical tables (see list-worksheet-logical-tables).",
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
              const worksheetId = worksheetResult.value.id;

              const tablesResult = await read(
                'worksheet logical tables',
                async (executor, signal) =>
                  await executor.listWorksheetLogicalTables(worksheetId, signal),
              );
              if (tablesResult.isErr()) {
                return tablesResult;
              }
              const tables = (tablesResult.value.tables ?? []).map((table) => ({
                id: table.id ?? '',
                name: table.caption ?? table.id ?? '',
              }));
              const tableMatch = resolveItemByNameOrId('Logical table', logicalTable, tables);
              if (tableMatch.isErr()) {
                return tableMatch.error.toErr();
              }
              const logicalTableId = tableMatch.value.id;

              let qualifiedColumns: Array<string> | undefined;
              if (columns && columns.length > 0) {
                const document = await read(
                  'worksheet document',
                  async (executor, signal) =>
                    await executor.getWorksheetDocument(worksheetId, signal),
                );
                if (document.isErr()) {
                  return document;
                }
                const qualified = qualifyColumnFields(document.value.xml, columns);
                if (!qualified.ok) {
                  return new ArgsValidationError(
                    `Cannot restrict columns: ${qualified.reason}.`,
                  ).toErr();
                }
                qualifiedColumns = qualified.columns;
              }

              const query: WorksheetUnderlyingDataQuery = {
                maxRows: Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP),
                ...(includeAllColumns !== undefined ? { includeAllColumns } : {}),
                ...(qualifiedColumns ? { columnsToIncludeByFieldName: qualifiedColumns } : {}),
              };

              return await read(
                'worksheet underlying data',
                async (executor, signal) =>
                  await executor.getWorksheetUnderlyingData(
                    worksheetId,
                    logicalTableId,
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
