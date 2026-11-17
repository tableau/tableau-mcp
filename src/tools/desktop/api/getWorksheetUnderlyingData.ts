import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetUnderlyingDataQuery } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { outputModeParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import {
  buildRowsToolResult,
  resolveLogicalTable,
  rowParamsWithoutTable,
} from './logicalTables.js';
import { qualifyColumnFields } from './qualifyColumnField.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: sessionParam(),
  sheetId: z.string().min(1).describe('Worksheet id or name.'),
  logicalTableId: z
    .string()
    .min(1)
    .optional()
    .describe('Table id or caption; omit to list tables.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  mode: outputModeParam(),
  includeAllColumns: z.boolean().optional().describe('Add unreferenced columns.'),
  columns: z.array(z.string()).optional().describe('Fields to keep.'),
};
const title = 'Get Worksheet Underlying Data';

export const getWorksheetUnderlyingDataTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetUnderlyingData = new DesktopTool({
    server,
    name: 'get-worksheet-underlying-data',
    title,
    description: "A worksheet's logical tables; with logicalTableId, that table's rows.",
    paramsSchema,
    annotations: {
      readOnlyHint: false, // file mode writes a cache file
      destructiveHint: false,
      idempotentHint: false, // each file-mode call writes a new cache file
      openWorldHint: false,
    },
    callback: async (
      { session, sheetId, logicalTableId, maxRows, mode, includeAllColumns, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getWorksheetUnderlyingData.logAndExecute({
        extra,
        args: { session, sheetId, logicalTableId, maxRows, mode, includeAllColumns, columns },
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
        getSuccessResult: (result) =>
          logicalTableId === undefined
            ? { isError: false, content: [{ type: 'text', text: JSON.stringify(result) }] }
            : buildRowsToolResult({ rows: result, mode, cachePrefix: 'worksheet-rows' }),
      });
    },
  });

  return getWorksheetUnderlyingData;
};
