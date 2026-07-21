import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetItem } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheet: z.string().optional().describe('Worksheet name/id; omit if unique.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z.array(z.string()).optional().describe('Fields.'),
};

class ExternalApiRequiredError extends McpToolError {
  constructor(toolName: string) {
    super({
      type: 'external-api-required',
      message: `${toolName} requires the Tableau Desktop External Client API transport.`,
      statusCode: 400,
    });
  }
}

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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getSummaryData.name).toErr();
          }

          const worksheetsResult = await executor.listWorksheets(extra.signal);
          if (worksheetsResult.isErr()) {
            if (isRouteMissing(worksheetsResult.error)) {
              return endpointNotInThisBuild('worksheet list').toErr();
            }
            return new DesktopCommandExecutionError(worksheetsResult.error).toErr();
          }

          const worksheetResult = resolveWorksheet(
            worksheet,
            worksheetsResult.value.worksheets ?? [],
          );
          if (worksheetResult.isErr()) {
            return worksheetResult.error.toErr();
          }

          const resolvedMaxRows = clampMaxRows(maxRows);
          const summaryResult = await executor.getWorksheetSummaryData(
            worksheetResult.value.id,
            {
              maxRows: resolvedMaxRows,
              ...(columns && columns.length > 0
                ? { columnsToIncludeByFieldName: columns.join(',') }
                : {}),
            },
            extra.signal,
          );
          if (summaryResult.isErr()) {
            if (isRouteMissing(summaryResult.error)) {
              return endpointNotInThisBuild('summary-data').toErr();
            }
            return new DesktopCommandExecutionError(summaryResult.error).toErr();
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
