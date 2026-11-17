import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetUnderlyingDataQuery } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveLogicalTable, rowParamsWithoutTable } from './logicalTables.js';
import { qualifyColumnFields } from './qualifyColumnField.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: sessionParam(),
  sheetId: z.string().min(1).describe('Worksheet id; a name also works.'),
  logicalTableId: z
    .string()
    .min(1)
    .optional()
    .describe('Logical table id or caption. Omit it to list the tables.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  includeAllColumns: z
    .boolean()
    .optional()
    .describe('Include columns the view does not reference.'),
  columns: z.array(z.string()).optional().describe('Field names to keep (e.g. "Region").'),
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
      "Without logicalTableId: a worksheet's logical tables (id + caption). With it: that table's underlying rows.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, sheetId, logicalTableId, maxRows, includeAllColumns, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getWorksheetUnderlyingData.logAndExecute({
        extra,
        args: { session, sheetId, logicalTableId, maxRows, includeAllColumns, columns },
        callback: async () => {
          if (logicalTableId === undefined) {
            const stray = rowParamsWithoutTable({ maxRows, includeAllColumns, columns });
            if (stray) {
              return stray.toErr();
            }
          }

          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (executor, signal, read) => {
              let worksheetId = sheetId;
              let byId = await executor.listWorksheetLogicalTables(worksheetId, signal);
              if (
                byId.isErr() &&
                byId.error.type === 'command-failed' &&
                byId.error.error?.code === 'sheet-not-found'
              ) {
                const listResult = await read(
                  'worksheet list',
                  async (activeExecutor, activeSignal) =>
                    await activeExecutor.listWorksheets(activeSignal),
                );
                if (listResult.isErr()) {
                  return listResult;
                }
                const worksheetResult = resolveItemByNameOrId(
                  'Worksheet',
                  sheetId,
                  listResult.value.worksheets ?? [],
                );
                if (worksheetResult.isErr()) {
                  return worksheetResult.error.toErr();
                }
                if (worksheetResult.value.id !== sheetId) {
                  worksheetId = worksheetResult.value.id;
                  byId = await executor.listWorksheetLogicalTables(worksheetId, signal);
                }
              }
              const tablesResult = await read(
                'worksheet logical tables',
                async () => await Promise.resolve(byId),
              );
              if (tablesResult.isErr() || logicalTableId === undefined) {
                return tablesResult;
              }

              const tableMatch = resolveLogicalTable(logicalTableId, tablesResult.value);
              if (tableMatch.isErr()) {
                return tableMatch.error.toErr();
              }
              const resolvedTableId = tableMatch.value.id;

              let qualifiedColumns: Array<string> | undefined;
              if (columns && columns.length > 0) {
                const document = await read(
                  'worksheet document',
                  async (activeExecutor, activeSignal) =>
                    await activeExecutor.getWorksheetDocument(worksheetId, activeSignal),
                );
                if (document.isErr()) {
                  return document;
                }
                const qualified = qualifyColumnFields(
                  document.value.xml,
                  columns,
                  executor.desktopApiVersion,
                );
                if (!qualified.ok) {
                  return new ArgsValidationError(
                    `Cannot restrict columns: ${qualified.reason}.`,
                  ).toErr();
                }
                qualifiedColumns = qualified.columns;
              }

              const query: WorksheetUnderlyingDataQuery = {
                maxRows: Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP),
                ignoreSelection: true,
                ...(includeAllColumns !== undefined ? { includeAllColumns } : {}),
                ...(qualifiedColumns ? { columnsToIncludeByFieldName: qualifiedColumns } : {}),
              };

              return await read(
                'worksheet underlying data',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.getWorksheetUnderlyingData(
                    worksheetId,
                    resolvedTableId,
                    query,
                    activeSignal,
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
