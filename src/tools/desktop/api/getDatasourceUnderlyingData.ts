import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import { DATASOURCE_LOGICAL_TABLES_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import {
  DatasourceItem,
  DatasourceLogicalTableDataQuery,
} from '../../../desktop/externalApi/types.js';
import { qualifyDatasourceColumn } from '../../../desktop/wrappers/qualifyDatasourceColumn.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { outputModeParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { isNotADatasourceId } from './getDatasources.js';
import {
  buildRowsToolResult,
  resolveLogicalTable,
  rowParamsWithoutTable,
} from './logicalTables.js';
import { isDatasourceQualified } from './qualifyColumnField.js';
import { resolveDatasource } from './resolveDatasourceRef.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: sessionParam(),
  datasourceId: z.string().min(1).describe('Datasource id (percent-encoded), name or caption.'),
  logicalTableId: z
    .string()
    .min(1)
    .optional()
    .describe('Table id or caption; omit to list tables.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  mode: outputModeParam(),
  columns: z.array(z.string().min(1)).optional().describe('Source column names to keep.'),
};
const title = 'Get Datasource Underlying Data';

export const getDatasourceUnderlyingDataTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getDatasourceUnderlyingData = new DesktopTool({
    server,
    name: 'get-datasource-underlying-data',
    minApiVersion: DATASOURCE_LOGICAL_TABLES_MIN_API_VERSION,
    title,
    description: "Lists a datasource's logical tables, or a table's raw rows with logicalTableId.",
    paramsSchema,
    annotations: {
      readOnlyHint: false, // file mode writes a cache file
      destructiveHint: false,
      idempotentHint: false, // each file-mode call writes a new cache file
      openWorldHint: false,
    },
    callback: async (
      { session, datasourceId, logicalTableId, maxRows, mode, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getDatasourceUnderlyingData.logAndExecute({
        extra,
        args: { session, datasourceId, logicalTableId, maxRows, mode, columns },
        callback: async () => {
          if (logicalTableId === undefined) {
            const stray = rowParamsWithoutTable({ maxRows, columns });
            if (stray) {
              return stray.toErr();
            }
          }

          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (executor, signal, read) => {
              let resolvedId = datasourceId;
              let datasources: DatasourceItem[] | undefined;
              const listDatasources = async (): Promise<Result<DatasourceItem[], McpToolError>> =>
                (
                  await read(
                    'workbook datasources',
                    async (activeExecutor, activeSignal) =>
                      await activeExecutor.listWorkbookDatasources(activeSignal),
                  )
                ).map((list) => list.datasources ?? []);

              let byId = await executor.listDatasourceLogicalTables(resolvedId, signal);
              if (byId.isErr() && isNotADatasourceId(byId.error)) {
                const list = await listDatasources();
                if (list.isErr()) {
                  return list;
                }
                datasources = list.value;
                const resolved = resolveDatasource(datasourceId, datasources);
                if (resolved.isErr()) {
                  return resolved.error.toErr();
                }
                if (resolved.value.id !== datasourceId) {
                  resolvedId = resolved.value.id;
                  byId = await executor.listDatasourceLogicalTables(resolvedId, signal);
                }
              }
              const tablesResult = await read(
                'datasource logical tables',
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

              let qualifiedColumns: string[] | undefined;
              if (columns && columns.length > 0) {
                if (datasources === undefined) {
                  const list = await listDatasources();
                  if (list.isErr()) {
                    return list;
                  }
                  datasources = list.value;
                }
                const datasource = resolveDatasource(resolvedId, datasources);
                if (datasource.isErr()) {
                  return datasource.error.toErr();
                }
                const { name: internalName, caption } = datasource.value;
                qualifiedColumns = columns.map((raw) => {
                  const column = raw.trim();
                  return isDatasourceQualified(column)
                    ? column
                    : qualifyDatasourceColumn(
                        executor.desktopApiVersion,
                        { internalName, caption: caption ?? internalName },
                        column,
                      );
                });
              }

              const query: DatasourceLogicalTableDataQuery = {
                maxRows: Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP),
                ...(qualifiedColumns ? { columnsToIncludeByFieldName: qualifiedColumns } : {}),
              };

              return await read(
                'datasource underlying data',
                async (activeExecutor, activeSignal) =>
                  await activeExecutor.getDatasourceLogicalTableData(
                    resolvedId,
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
            : buildRowsToolResult({ rows: result, mode, cachePrefix: 'datasource-rows' }),
      });
    },
  });

  return getDatasourceUnderlyingData;
};
