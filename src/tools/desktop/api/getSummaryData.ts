import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { BLOCKING_DIALOG_GUIDANCE } from '../../../desktop/callDeadline.js';
import { WorksheetItem } from '../../../desktop/externalApi/types.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  McpToolError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { deprecatedArtifactAliasParam, resolveArtifactNameArg } from '../params.js';
import {
  doneNextAction,
  jsonToolResult,
  NextAction,
  prefillNextAction,
  receipt,
  StructuredResult,
  WireStructuredContent,
  wireStructuredContent,
  withNextAction,
} from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { fetchWorksheetSummaryData, type SummaryRowOrder } from './summaryDataCore.js';

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS_CAP = 1000;
const EMPTY_SHEET_GUIDANCE =
  'Desktop returned no summary columns for this sheet. Do NOT call get-summary-data again for this ask — name a sheet with fields on the view, or build and apply one first.';
const NO_ROWS_GUIDANCE =
  "The summary query returned no rows. Do NOT call get-summary-data again for this ask — the answer is 'no data'; say so.";
const SUMMARY_DATA_DONE_LABEL = 'Data retrieval complete — no further calls needed';
const EMPTY_SHEET_BUILD_LABEL = 'List templates, build a chart, then apply it';
const SUMMARY_DATA_FAILURE_DONE_LABEL = 'Data retrieval failed — report outcome';
const WORKSHEET_AMBIGUOUS_GUIDANCE =
  'Choose one worksheet by exact id or name, then call get-summary-data again.';
const WORKSHEET_NOT_FOUND_GUIDANCE =
  'The requested worksheet was not found. Choose an available populated worksheet, correct the worksheet name/id, or use list-templates, build-worksheets-from-templates, and apply-worksheet before calling get-summary-data again.';
const COLUMNS_NOT_FOUND_GUIDANCE =
  'Use exact column names returned by this worksheet, or omit columns to retrieve the full summary table.';
const TRANSIENT_FAILURE_GUIDANCE =
  'The request may be transient — one retry is reasonable. If it fails again, report the failure.';
const REPEATED_TRANSIENT_FAILURE_GUIDANCE =
  'The request is still failing — report the outcome; do not call again.';
// Session resolution failures happen before a Desktop pid is known; keep them in a
// dedicated session scope so unresolved discovery noise cannot poison a resolved session.
const SUMMARY_DATA_UNRESOLVED_SESSION_SCOPE = '__summary-data-session-unresolved__';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetName: z.string().optional().describe('Worksheet name/id; omit if unique.'),
  worksheet: deprecatedArtifactAliasParam('worksheet'),
  maxRows: z.number().int().positive().optional().describe('Default 200; max 1000.'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Field names to restrict the returned columns (e.g. "Region").'),
};

type SummaryDataValue = {
  worksheet: { id: string; name: string };
  maxRows: number;
  shape: string;
  rowOrder: SummaryRowOrder;
  summaryData: { columns: unknown[]; rows: unknown[] };
};

type SummaryDataCompletedBody =
  | ({ status: 'success' } & SummaryDataValue)
  | ({
      status: 'terminal';
      reason: 'no-rows';
      guidance: string;
    } & SummaryDataValue)
  | ({
      status: 'action-required';
      reason: 'empty-sheet';
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
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheetName, worksheet, maxRows, columns },
      extra,
    ): Promise<CallToolResult> => {
      return await getSummaryData.logAndExecute({
        extra,
        args: { session, worksheetName, worksheet, maxRows, columns },
        callback: async (): Promise<Result<SummaryDataCompletedResult, McpToolError>> => {
          // The worksheet selector stays optional (omit when unique); the resolver here
          // only rejects a worksheetName/alias conflict and coalesces the two keys.
          const worksheetArg = resolveArtifactNameArg('worksheet', worksheetName, worksheet, {
            allowMissing: true,
          });
          if (worksheetArg.isErr()) {
            return worksheetArg;
          }
          const requestedWorksheet = worksheetArg.value;
          let transientAccountingSessionId = SUMMARY_DATA_UNRESOLVED_SESSION_SCOPE;
          const resolvedMaxRows = clampMaxRows(maxRows);
          const resolvedSignature = summaryDataSignature({
            worksheet: requestedWorksheet,
            maxRows: resolvedMaxRows,
            columns,
          });
          const unresolvedSignature = summaryDataUnresolvedSignature({
            requestedSession: session,
            worksheet: requestedWorksheet,
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

            // The tool resolves the session itself (the error branch above must account
            // the failure under the unresolved scope BEFORE any harness work), so hand
            // the harness the ORIGINAL session rather than re-resolving the resolved pid.
            const result = await runExternalApiReadTool<SummaryDataCompletedResult>({
              session,
              extra,
              callback: async (_executor, _signal, read) => {
                const summaryResult = await fetchWorksheetSummaryData({
                  read,
                  worksheet: requestedWorksheet,
                  maxRows: resolvedMaxRows,
                  columns,
                  materializeEmpty: true,
                });
                if (summaryResult.isErr()) {
                  if (summaryResult.error.type === 'worksheet') {
                    return worksheetError(summaryResult.error.error).toErr();
                  }
                  if (summaryResult.error.type === 'columns') {
                    return columnsError(summaryResult.error.error).toErr();
                  }
                  return requestError(summaryResult.error.error).toErr();
                }

                const resolvedWorksheet = summaryResult.value.worksheet;
                const dataColumns = summaryResult.value.columns;
                const dataRows = summaryResult.value.rows;
                if (dataColumns.length === 0) {
                  return new Ok(
                    emptySheetResult(
                      resolvedWorksheet,
                      resolvedMaxRows,
                      summaryResult.value.rowOrder,
                    ),
                  );
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
                        rowOrder: summaryResult.value.rowOrder,
                        summaryData: { columns: dataColumns, rows: dataRows },
                        guidance: NO_ROWS_GUIDANCE,
                      },
                      doneNextAction(
                        receipt({
                          did: [
                            `queried summary data for worksheet "${resolvedWorksheet.name}" (maxRows ${resolvedMaxRows})`,
                            `the sheet returned ${dataColumns.length} column(s) and 0 rows`,
                          ],
                          didNot: ['return any data values — there were none to return'],
                          // The endpoint answers with the sheet's own summary table. An empty
                          // one is indistinguishable here from a filter that excludes
                          // everything or a source with no matching data, so do not let the
                          // agent read "no rows" as "no such data exists".
                          unverified: [
                            'why the result is empty — a filter, the data source, or the sheet itself are indistinguishable from here',
                          ],
                        }),
                        SUMMARY_DATA_DONE_LABEL,
                      ),
                    ),
                  );
                }

                return new Ok({
                  status: 'success' as const,
                  worksheet: { id: resolvedWorksheet.id, name: resolvedWorksheet.name },
                  maxRows: resolvedMaxRows,
                  shape: `${dataRows.length} rows x ${dataColumns.length} columns`,
                  rowOrder: summaryResult.value.rowOrder,
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
  | 'columns-not-found'
  | 'session-resolution-failed'
  | 'request-failed'
  | 'endpoint-unavailable'
  | 'desktop-blocked';

class SummaryDataResponseError extends McpToolError {
  readonly structuredContent: WireStructuredContent;
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
    // getErrorText() below is the `content` copy, which a structuredContent-preferring
    // client never reads. Fold the same body in so the agent keeps the reason and the
    // guidance instead of a bare "what to do next".
    this.structuredContent = wireStructuredContent(this.body, {
      nextAction: nextActionForSummaryError(status, reason),
    });
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
  // A blocking dialog (awaiting-user) or a hung call never clears on a retry, so keep it off the
  // transient retry path — telling the agent to retry just wedges Desktop against the same dialog.
  if (error instanceof DesktopCommandExecutionError && error.blockedByDesktopDialog) {
    return summaryDataError(error, 'action-required', 'desktop-blocked', BLOCKING_DIALOG_GUIDANCE);
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

function columnsError(error: ArgsValidationError): SummaryDataResponseError {
  return summaryDataError(
    error,
    'action-required',
    'columns-not-found',
    COLUMNS_NOT_FOUND_GUIDANCE,
  );
}

function emptySheetResult(
  worksheet: WorksheetItem,
  maxRows: number,
  rowOrder: SummaryRowOrder,
): SummaryDataCompletedResult {
  return withNextAction(
    {
      status: 'action-required' as const,
      reason: 'empty-sheet' as const,
      worksheet: { id: worksheet.id, name: worksheet.name },
      maxRows,
      shape: '0 rows x 0 columns',
      rowOrder,
      summaryData: { columns: [], rows: [] },
      guidance: EMPTY_SHEET_GUIDANCE,
    },
    prefillNextAction(EMPTY_SHEET_BUILD_LABEL),
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
    return doneNextAction(
      receipt({
        did: [`stopped get-summary-data on a terminal "${reason}" failure`],
        didNot: ['retrieve any summary data'],
        // "Terminal" is this tool's retry policy, not a statement about Desktop: a
        // worksheet-not-found or an exhausted transient budget says nothing about whether
        // the condition would clear on a later ask.
        unverified: ['whether the underlying condition is permanent'],
      }),
      SUMMARY_DATA_FAILURE_DONE_LABEL,
    );
  }
  if (status === 'retryable') {
    return prefillNextAction('Retry get-summary-data once');
  }
  if (reason === 'desktop-blocked') {
    return prefillNextAction('Dismiss any open Tableau dialog, then call list-instances');
  }
  if (reason === 'endpoint-unavailable') {
    return prefillNextAction('Update Desktop/API and retry');
  }
  if (reason === 'worksheet-not-found') {
    return prefillNextAction('Repair worksheet selection and retry');
  }
  if (reason === 'columns-not-found') {
    return prefillNextAction('Repair summary columns and retry');
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

function clampMaxRows(maxRows: number | undefined): number {
  return Math.min(maxRows ?? DEFAULT_MAX_ROWS, MAX_ROWS_CAP);
}
