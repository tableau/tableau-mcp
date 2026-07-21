import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetItem } from '../../../desktop/externalApi/types.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheet: z.string().optional().describe('Worksheet name/id; omit if unique.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z.array(z.string()).optional().describe('Fields.'),
};

const title = 'Get Summary Data';
export const getSummaryDataTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSummaryData = new DesktopTool({
    server,
    name: 'get-summary-data',
    title,
    description: [
      'Read the ACTUAL data behind a worksheet.',
      'FIRST PLAY for data questions and authoring choices: inspect rows before charts, calcs, filters, or answers.',
      'Carries only fields ON the view; add fields to Detail on the marks card first.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheet, maxRows, columns }, extra): Promise<CallToolResult> => {
      return await getSummaryData.logAndExecute({
        extra,
        args: { session, worksheet, maxRows, columns },
        callback: async () => {
          return await runExternalApiReadTool({
            toolName: getSummaryData.name,
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const worksheetsResult = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (worksheetsResult.isErr()) {
                return worksheetsResult;
              }

              const worksheetResult = resolveWorksheet(
                worksheet,
                worksheetsResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) {
                return worksheetResult.error.toErr();
              }

              const resolvedMaxRows = clampMaxRows(maxRows);
              const summaryResult = await read(
                'summary-data',
                async (executor, signal) =>
                  await executor.getWorksheetSummaryData(
                    worksheetResult.value.id,
                    {
                      maxRows: resolvedMaxRows,
                      ...(columns && columns.length > 0
                        ? { columnsToIncludeByFieldName: columns.join(',') }
                        : {}),
                    },
                    signal,
                  ),
              );
              if (summaryResult.isErr()) {
                return summaryResult;
              }

              const dataColumns = summaryResult.value.columns ?? [];
              const dataRows = summaryResult.value.rows ?? [];
              return new Ok({
                worksheet: { id: worksheetResult.value.id, name: worksheetResult.value.name },
                maxRows: resolvedMaxRows,
                shape: `${dataRows.length} rows x ${dataColumns.length} columns`,
                summaryData: { columns: dataColumns, rows: dataRows },
              });
            },
          });
        },
      });
    },
  });

  return getSummaryData;
};

function resolveWorksheet(
  worksheet: string | undefined,
  worksheets: WorksheetItem[],
): Result<WorksheetItem, ArgsValidationError> {
  const requested = worksheet?.trim();
  if (!requested) {
    if (worksheets.length === 1) {
      return new Ok(worksheets[0]);
    }
    return new ArgsValidationError(
      `Multiple worksheets exist. Specify worksheet by name or id. Available worksheets: ${formatWorksheets(
        worksheets,
      )}`,
    ).toErr();
  }

  return resolveItemByNameOrId('Worksheet', worksheet ?? '', worksheets);
}

function clampMaxRows(maxRows: number | undefined): number {
  return Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP);
}

function formatWorksheets(worksheets: WorksheetItem[]): string {
  return worksheets.map((worksheet) => `${worksheet.name} (${worksheet.id})`).join(', ');
}
