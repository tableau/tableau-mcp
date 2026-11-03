import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DATASOURCE_LOGICAL_TABLES_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { DatasourceLogicalTableDataQuery } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { isDatasourceQualified } from './qualifyColumnField.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: sessionParam(),
  datasourceName: artifactNameParam('datasource', { min: 1 }),
  logicalTable: z
    .string()
    .min(1)
    .describe("A logical table caption or id from the datasource's logical tables."),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z
    .array(z.string().min(1))
    .optional()
    .describe('Source column names to restrict the columns (e.g. "Region").'),
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
    description:
      "Read raw row-level data for one of a datasource's logical tables (see list-datasource-logical-tables), independent of any worksheet.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, datasourceName, logicalTable, maxRows, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getDatasourceUnderlyingData.logAndExecute({
        extra,
        args: { session, datasourceName, logicalTable, maxRows, columns },
        callback: async () => {
          const resolved = await resolveDatasourceRef({ session, datasourceName, extra });
          if (resolved.isErr()) {
            return resolved;
          }
          const { id: datasourceId, name: internalName } = resolved.value;

          return await runExternalApiReadTool({
            session: resolved.value.resolvedSession,
            extra,
            callback: async (_executor, _signal, read) => {
              const tablesResult = await read(
                'datasource logical tables',
                async (executor, signal) =>
                  await executor.listDatasourceLogicalTables(datasourceId, signal),
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

              const query: DatasourceLogicalTableDataQuery = {
                maxRows: Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP),
                ...(columns && columns.length > 0
                  ? {
                      columnsToIncludeByFieldName: columns.map((column) =>
                        qualifyColumn(internalName, column.trim()),
                      ),
                    }
                  : {}),
              };

              return await read(
                'datasource underlying data',
                async (executor, signal) =>
                  await executor.getDatasourceLogicalTableData(
                    datasourceId,
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

  return getDatasourceUnderlyingData;
};

function qualifyColumn(datasourceInternalName: string, column: string): string {
  if (isDatasourceQualified(column)) {
    return column;
  }
  const bare = column.startsWith('[') && column.endsWith(']') ? column.slice(1, -1) : column;
  return `[${datasourceInternalName}].[${bare}]`;
}
