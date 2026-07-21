import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
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
      'Read the ACTUAL data behind a worksheet (its summary/logical table).',
      'FIRST PLAY for data questions and authoring choices: look at the rows before picking charts, calcs, filters, or answering.',
      'Carries only fields ON the view: to inspect others, add them to Detail on the marks card first, then read.',
      'Structure shows shelves; this shows data.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ worksheet, maxRows, columns }, extra): Promise<CallToolResult> => {
      return await getSummaryData.logAndExecute({
        extra,
        args: { worksheet, maxRows, columns },
        callback: async () => {
          const sessionResult = resolveSession(undefined);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getSummaryData.name).toErr();
          }

          const worksheetsResult = await executor.listWorksheets(extra.signal);
          if (worksheetsResult.isErr()) {
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
              return new McpToolError({
                type: 'endpoint-not-in-this-build',
                message:
                  'This Tableau Desktop build does not serve the summary-data endpoint yet ' +
                  '(it ships in builds after monolith #60211). Everything else still works — ' +
                  'this data read lights up on the next Desktop update. Do not retry.',
                statusCode: 404,
              }).toErr();
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

  const idMatch = worksheets.find((candidate) => candidate.id === requested);
  if (idMatch) {
    return new Ok(idMatch);
  }

  const nameMatches = worksheets.filter((candidate) => candidate.name === requested);
  if (nameMatches.length === 1) {
    return new Ok(nameMatches[0]);
  }
  if (nameMatches.length > 1) {
    return new ArgsValidationError(
      `Worksheet "${requested}" matched multiple worksheets. Specify one id: ${formatWorksheets(
        nameMatches,
      )}`,
    ).toErr();
  }

  return new ArgsValidationError(
    `Worksheet "${requested}" was not found. Available worksheets: ${formatWorksheets(worksheets)}`,
  ).toErr();
}

function clampMaxRows(maxRows: number | undefined): number {
  return Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP);
}

function formatWorksheets(worksheets: WorksheetItem[]): string {
  return worksheets.map((worksheet) => `${worksheet.name} (${worksheet.id})`).join(', ');
}

/** A problem-404 route miss: the endpoint is newer than this Desktop build (post-#60211). */
export function isRouteMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as { type?: string; error?: { code?: string; message?: string } };
  return (
    e.type === 'command-failed' &&
    e.error?.code === 'not-found' &&
    typeof e.error?.message === 'string' &&
    e.error.message.includes('No route matches')
  );
}
