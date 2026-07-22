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
  NextAction,
  prefillNextAction,
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
const SUMMARY_DATA_DONE_LABEL = 'Data retrieval complete — no further calls needed';
const SUMMARY_DATA_FAILURE_DONE_LABEL = 'Data retrieval failed — report outcome';
const WORKSHEET_AMBIGUOUS_GUIDANCE =
  'Choose one worksheet by exact id or name, then call get-summary-data again.';
const WORKSHEET_NOT_FOUND_GUIDANCE =
  'The requested worksheet was not found. Choose an available populated worksheet, correct the worksheet name/id, or bind a chart first; then call get-summary-data again.';
const TRANSIENT_FAILURE_GUIDANCE =
  'The request may be transient — one retry is reasonable. If it fails again, report the failure.';
const REPEATED_TRANSIENT_FAILURE_GUIDANCE =
  'The request is still failing — report the outcome; do not call again.';
// Session resolution failures happen before a Desktop pid is known; keep them in a
// dedicated session scope so unresolved discovery noise cannot poison a resolved session.
const SUMMARY_DATA_UNRESOLVED_SESSION_SCOPE = '__summary-data-session-unresolved__';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheet: z.string().optional().describe('Worksheet name/id; omit if unique.'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z.array(z.string()).optional().describe('Fields.'),
};

type SummaryDataValue = {
  worksheet: { id: string; name: string };
  maxRows: number;
  shape: string;
  summaryData: { columns: unknown[]; rows: unknown[] };
};

type SummaryDataCompletedBody =
  | ({ status: 'success' } & SummaryDataValue)
  | ({
      status: 'terminal';
      reason: 'empty-sheet' | 'no-rows';
      guidance: string;
    } & SummaryDataValue);

type SummaryDataCompletedResult = StructuredResult<SummaryDataCompletedBody>;

const title = 'Get Summary Data';
export const getSummaryDataTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSummaryData = new DesktopTool({
    server,
    name: 'get-summary-data',
    title,
    description:
      'Read summary rows from a populated worksheet with fields on the view. A terminal/no-data result means stop; a transient failure may be retried once.',
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
        callback: async (): Promise<Result<SummaryDataCompletedResult, McpToolError>> => {
          let transientAccountingSessionId = SUMMARY_DATA_UNRESOLVED_SESSION_SCOPE;
          const resolvedMaxRows = clampMaxRows(maxRows);
          const resolvedSignature = summaryDataSignature({
            worksheet,
            maxRows: resolvedMaxRows,
            columns,
          });
          const unresolvedSignature = summaryDataUnresolvedSignature({
            requestedSession: session,
            worksheet,
            maxRows: resolvedMaxRows,
            columns,
          });
          let transientAccountingSignature = unresolvedSignature;
          try {
            const sessionResult = resolveSession(session);
            if (sessionResult.isErr()) {
              return withTransientRetryAccounting(
                summaryDataError(sessionResult.error, 'retryable', 'session-resolution-failed'),
                transientAccountingSessionId,
                transientAccountingSignature,
              ).toErr();
            }
            transientAccountingSessionId = sessionResult.value;
            transientAccountingSignature = resolvedSignature;

            const result = await runExternalApiReadTool<SummaryDataCompletedResult>({
              session: sessionResult.value,
              extra,
              callback: async (_executor, _signal, read) => {
                const worksheetsResult = await read(
                  'worksheet list',
                  async (executor, signal) => await executor.listWorksheets(signal),
                );
                if (worksheetsResult.isErr()) {
                  return requestError(worksheetsResult.error).toErr();
                }

                const worksheetResult = resolveWorksheet(
                  worksheet,
                  worksheetsResult.value.worksheets ?? [],
                );
                if (worksheetResult.isErr()) {
                  return worksheetError(worksheetResult.error).toErr();
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
                  return requestError(summaryResult.error).toErr();
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
                      doneNextAction(SUMMARY_DATA_DONE_LABEL),
                    ),
                  );
                }

                return new Ok({
                  status: 'success' as const,
                  worksheet: { id: resolvedWorksheet.id, name: resolvedWorksheet.name },
                  maxRows: resolvedMaxRows,
                  shape: `${dataRows.length} rows x ${dataColumns.length} columns`,
                  summaryData: { columns: dataColumns, rows: dataRows },
                });
              },
            });
            if (result.isErr()) {
              return withTransientRetryAccounting(
                requestError(result.error),
                sessionResult.value,
                resolvedSignature,
              ).toErr();
            }
            sessionRouteState.clearSummaryDataTransientFailure(
              sessionResult.value,
              resolvedSignature,
            );
            sessionRouteState.clearSummaryDataTransientFailure(
              SUMMARY_DATA_UNRESOLVED_SESSION_SCOPE,
              unresolvedSignature,
            );
            return result;
          } catch (error) {
            return withTransientRetryAccounting(
              requestError(new UnknownError(getExceptionMessage(error))),
              transientAccountingSessionId,
              transientAccountingSignature,
            ).toErr();
          }
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return getSummaryData;
};

type SummaryDataErrorStatus = 'terminal' | 'retryable' | 'action-required';
type SummaryDataErrorReason =
  | 'worksheet-not-found'
  | 'worksheet-ambiguous'
  | 'session-resolution-failed'
  | 'request-failed'
  | 'endpoint-unavailable';

class SummaryDataResponseError extends McpToolError {
  readonly structuredContent: StructuredContent;
  readonly summaryStatus: SummaryDataErrorStatus;
  readonly summaryReason: SummaryDataErrorReason;
  private readonly errorBody: { type: string; message: string };
  private readonly body: {
    status: SummaryDataErrorStatus;
    reason: SummaryDataErrorReason;
    guidance: string;
    error: { type: string; message: string };
  };

  constructor(
    error: McpToolError,
    status: SummaryDataErrorStatus,
    reason: SummaryDataErrorReason,
    guidance: string,
    errorBody?: { type: string; message: string },
  ) {
    super({
      type: error.type,
      message: error.message,
      statusCode: error.statusCode,
      internalStatusCode: error.internalStatusCode,
      internalError: error.internalError,
      internalErrorDetails: error.internalErrorDetails,
    });
    this.summaryStatus = status;
    this.summaryReason = reason;
    this.errorBody = errorBody ?? { type: error.type, message: error.getErrorText() };
    this.body = {
      status,
      reason,
      guidance,
      error: this.errorBody,
    };
    this.structuredContent = {
      nextAction: nextActionForSummaryError(status, reason),
    };
  }

  override getErrorText(): string {
    return JSON.stringify(this.body);
  }

  withDisposition(status: SummaryDataErrorStatus, guidance: string): SummaryDataResponseError {
    return new SummaryDataResponseError(this, status, this.summaryReason, guidance, this.errorBody);
  }
}

function summaryDataError(
  error: McpToolError,
  status: SummaryDataErrorStatus,
  reason: SummaryDataErrorReason,
  guidance = TRANSIENT_FAILURE_GUIDANCE,
): SummaryDataResponseError {
  if (error instanceof SummaryDataResponseError) {
    return error;
  }
  return new SummaryDataResponseError(error, status, reason, guidance);
}

function requestError(error: McpToolError): SummaryDataResponseError {
  if (error instanceof SummaryDataResponseError) {
    return error;
  }
  return error.statusCode >= 500
    ? summaryDataError(error, 'retryable', 'request-failed')
    : summaryDataError(
        error,
        'action-required',
        'endpoint-unavailable',
        `${error.getErrorText()} Update Desktop/API or correct the request before calling get-summary-data again.`,
      );
}

function worksheetError(error: ArgsValidationError): SummaryDataResponseError {
  return error.message.includes('was not found')
    ? summaryDataError(
        error,
        'action-required',
        'worksheet-not-found',
        WORKSHEET_NOT_FOUND_GUIDANCE,
      )
    : summaryDataError(
        error,
        'action-required',
        'worksheet-ambiguous',
        WORKSHEET_AMBIGUOUS_GUIDANCE,
      );
}

function emptySheetResult(worksheet: WorksheetItem, maxRows: number): SummaryDataCompletedResult {
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
    doneNextAction(SUMMARY_DATA_DONE_LABEL),
  );
}

function withTransientRetryAccounting(
  error: SummaryDataResponseError,
  sessionId: string,
  signature: string,
): SummaryDataResponseError {
  if (error.summaryStatus !== 'retryable') {
    return error;
  }
  const count = sessionRouteState.recordSummaryDataTransientFailure(sessionId, signature);
  return count >= 2
    ? error.withDisposition('terminal', REPEATED_TRANSIENT_FAILURE_GUIDANCE)
    : error;
}

function nextActionForSummaryError(
  status: SummaryDataErrorStatus,
  reason: SummaryDataErrorReason,
): NextAction {
  if (status === 'terminal') {
    return doneNextAction(SUMMARY_DATA_FAILURE_DONE_LABEL);
  }
  if (status === 'retryable') {
    return prefillNextAction('Retry get-summary-data once');
  }
  if (reason === 'endpoint-unavailable') {
    return prefillNextAction('Update Desktop/API and retry');
  }
  if (reason === 'worksheet-not-found') {
    return prefillNextAction('Repair worksheet selection and retry');
  }
  return prefillNextAction('Choose a worksheet and retry');
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
  return JSON.stringify(summaryDataSignatureParts({ worksheet, maxRows, columns }));
}

function summaryDataSignatureParts({
  worksheet,
  maxRows,
  columns,
}: {
  worksheet: string | undefined;
  maxRows: number;
  columns: string[] | undefined;
}): { worksheet: string | null; maxRows: number; columns: string[] | null } {
  return {
    worksheet: worksheet?.trim() || null,
    maxRows,
    columns: columns && columns.length > 0 ? columns : null,
  };
}

function summaryDataUnresolvedSignature({
  requestedSession,
  worksheet,
  maxRows,
  columns,
}: {
  requestedSession: string | undefined;
  worksheet: string | undefined;
  maxRows: number;
  columns: string[] | undefined;
}): string {
  return JSON.stringify({
    requestedSession: requestedSession ?? null,
    args: summaryDataSignatureParts({ worksheet, maxRows, columns }),
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
