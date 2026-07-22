import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetItem } from '../../../desktop/externalApi/types.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { ArgsValidationError, McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import {
  doneNextAction,
  jsonToolResult,
  StructuredContent,
  StructuredResult,
  withNextAction,
} from '../structuredContent.js';
import { DesktopTool } from '../tool.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;
const EMPTY_SHEET_GUIDANCE =
  'This sheet has no marks to summarize. Do NOT call get-summary-data again for this ask — bind a chart first (bind-template) or name a populated sheet.';
const NO_ROWS_GUIDANCE =
  "The summary query returned no rows. Do NOT call get-summary-data again for this ask — the answer is 'no data'; say so.";
const REPEATED_REQUEST_GUIDANCE =
  'You already asked for this summary data with the same arguments. Do NOT call get-summary-data again for this ask; use the prior result or report that no data was available.';
const INVALID_WORKSHEET_GUIDANCE =
  'The requested worksheet is not a valid retrieval source. Do NOT call get-summary-data again for this ask; name a populated sheet or bind a chart first.';
const REQUEST_FAILED_GUIDANCE =
  'get-summary-data could not retrieve rows. Do NOT call get-summary-data again for this ask; report the failure and use a populated worksheet only if the user requests another attempt.';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheet: z.string().optional().describe('Worksheet name/id; omit if unique.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z.array(z.string()).optional().describe('Fields.'),
};

type SummaryDataToolResult = StructuredResult<object>;

const title = 'Get Summary Data';
export const getSummaryDataTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSummaryData = new DesktopTool({
    server,
    name: 'get-summary-data',
    title,
    description:
      'Read summary rows from a populated worksheet with fields on the view. Empty, no-row, failed, or repeated requests are terminal and must not be polled.',
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
        callback: async (): Promise<Result<SummaryDataToolResult, McpToolError>> => {
          try {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return terminalError(sessionResult.error, 'request-failed').toErr();
            }

            const resolvedMaxRows = clampMaxRows(maxRows);
            const signature = summaryDataSignature({
              worksheet,
              maxRows: resolvedMaxRows,
              columns,
            });
            if (sessionRouteState.isSummaryDataRepeat(sessionResult.value, signature)) {
              return new Ok(
                withNextAction(
                  {
                    status: 'terminal' as const,
                    reason: 'repeated-request' as const,
                    guidance: REPEATED_REQUEST_GUIDANCE,
                  },
                  doneNextAction('Stop — use the prior summary-data result'),
                ),
              );
            }

            const result = await runExternalApiReadTool<SummaryDataToolResult>({
              session: sessionResult.value,
              extra,
              callback: async (_executor, _signal, read) => {
                const worksheetsResult = await read(
                  'worksheet list',
                  async (executor, signal) => await executor.listWorksheets(signal),
                );
                if (worksheetsResult.isErr()) {
                  return terminalError(worksheetsResult.error, 'request-failed').toErr();
                }

                const worksheetResult = resolveWorksheet(
                  worksheet,
                  worksheetsResult.value.worksheets ?? [],
                );
                if (worksheetResult.isErr()) {
                  return terminalError(worksheetResult.error, 'invalid-worksheet').toErr();
                }

                const resolvedWorksheet = worksheetResult.value;
                if (resolvedWorksheet.datasources?.length === 0) {
                  return new Ok(emptySheetResult(resolvedWorksheet, resolvedMaxRows));
                }

                const summaryResult = await read(
                  'summary-data',
                  async (executor, signal) =>
                    await executor.getWorksheetSummaryData(
                      resolvedWorksheet.id,
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
                  return terminalError(summaryResult.error, 'request-failed').toErr();
                }

                const dataColumns = summaryResult.value.columns ?? [];
                const dataRows = summaryResult.value.rows ?? [];
                if (dataColumns.length === 0) {
                  return new Ok(emptySheetResult(resolvedWorksheet, resolvedMaxRows));
                }
                if (dataRows.length === 0) {
                  return new Ok(
                    withNextAction(
                      {
                        status: 'terminal' as const,
                        reason: 'no-rows' as const,
                        worksheet: {
                          id: resolvedWorksheet.id,
                          name: resolvedWorksheet.name,
                        },
                        maxRows: resolvedMaxRows,
                        shape: `0 rows x ${dataColumns.length} columns`,
                        summaryData: { columns: dataColumns, rows: dataRows },
                        guidance: NO_ROWS_GUIDANCE,
                      },
                      doneNextAction('Stop — report that the query returned no data'),
                    ),
                  );
                }

                return new Ok({
                  worksheet: { id: resolvedWorksheet.id, name: resolvedWorksheet.name },
                  maxRows: resolvedMaxRows,
                  shape: `${dataRows.length} rows x ${dataColumns.length} columns`,
                  summaryData: { columns: dataColumns, rows: dataRows },
                });
              },
            });
            return result.isErr() ? terminalError(result.error, 'request-failed').toErr() : result;
          } catch (error) {
            return terminalError(
              new UnknownError(getExceptionMessage(error)),
              'request-failed',
            ).toErr();
          }
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return getSummaryData;
};

type SummaryDataTerminalReason = 'invalid-worksheet' | 'request-failed';

class SummaryDataTerminalError extends McpToolError {
  readonly structuredContent: StructuredContent;
  private readonly body: {
    status: 'terminal';
    reason: SummaryDataTerminalReason;
    guidance: string;
    error: { type: string; message: string };
  };

  constructor(
    error: McpToolError,
    reason: SummaryDataTerminalReason,
    guidance: string,
    nextActionLabel: string,
  ) {
    super({
      type: error.type,
      message: error.message,
      statusCode: error.statusCode,
      internalStatusCode: error.internalStatusCode,
      internalError: error.internalError,
      internalErrorDetails: error.internalErrorDetails,
    });
    this.body = {
      status: 'terminal',
      reason,
      guidance,
      error: { type: error.type, message: error.getErrorText() },
    };
    this.structuredContent = { nextAction: doneNextAction(nextActionLabel) };
  }

  override getErrorText(): string {
    return JSON.stringify(this.body);
  }
}

function terminalError(
  error: McpToolError,
  reason: SummaryDataTerminalReason,
): SummaryDataTerminalError {
  if (error instanceof SummaryDataTerminalError) {
    return error;
  }
  return reason === 'invalid-worksheet'
    ? new SummaryDataTerminalError(
        error,
        reason,
        INVALID_WORKSHEET_GUIDANCE,
        'Stop — choose a populated worksheet or bind a chart',
      )
    : new SummaryDataTerminalError(
        error,
        reason,
        REQUEST_FAILED_GUIDANCE,
        'Stop — report the summary-data retrieval failure',
      );
}

function emptySheetResult(
  worksheet: WorksheetItem,
  maxRows: number,
): StructuredResult<{
  status: 'terminal';
  reason: 'empty-sheet';
  worksheet: { id: string; name: string };
  maxRows: number;
  shape: string;
  summaryData: { columns: unknown[]; rows: unknown[] };
  guidance: string;
}> {
  return withNextAction(
    {
      status: 'terminal' as const,
      reason: 'empty-sheet' as const,
      worksheet: { id: worksheet.id, name: worksheet.name },
      maxRows,
      shape: '0 rows x 0 columns',
      summaryData: { columns: [], rows: [] },
      guidance: EMPTY_SHEET_GUIDANCE,
    },
    doneNextAction('Stop polling; bind a chart or choose a populated sheet'),
  );
}

function summaryDataSignature({
  worksheet,
  maxRows,
  columns,
}: {
  worksheet: string | undefined;
  maxRows: number;
  columns: string[] | undefined;
}): string {
  return JSON.stringify({
    worksheet: worksheet?.trim() || null,
    maxRows,
    columns: columns && columns.length > 0 ? columns : null,
  });
}

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
