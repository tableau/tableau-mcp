import { McpToolError } from '../../../errors/mcpToolError.js';
import { TableauRestError } from '../../../sdks/tableau/tableauRestError.js';
import { isAxiosError } from '../../../utils/axios.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';

/**
 * Tableau's structured REST error body: `{ error: { code, summary, detail } }`.
 * Surfacing `code`/`summary`/`detail` verbatim (rather than a generic axios
 * message) follows the existing convention in `viewsMethods` and lets callers
 * recover from a specific Tableau condition without parsing axios internals.
 */
function extractTableauError(
  error: unknown,
): { code?: string; summary?: string; detail?: string } | null {
  // Tableau error surfaced in a 2xx body and normalized by the SDK method.
  if (error instanceof TableauRestError) {
    return error.tableauError;
  }
  const axiosError = isAxiosError(error)
    ? error
    : error instanceof Error && isAxiosError(error.cause)
      ? error.cause
      : undefined;
  if (!axiosError) {
    return null;
  }
  const tableauError = (axiosError.response?.data as { error?: unknown } | undefined)?.error as
    | { code?: string; summary?: string; detail?: string }
    | undefined;
  if (tableauError && (tableauError.summary || tableauError.code)) {
    return tableauError;
  }
  return null;
}

/** Format `{ code, summary, detail }` as `Tableau [code]: summary: detail`. */
function formatTableauError(t: { code?: string; summary?: string; detail?: string }): string {
  const head = `Tableau${t.code ? ` [${t.code}]` : ''}`;
  const body = t.detail && t.summary ? `${t.summary}: ${t.detail}` : t.summary || t.detail || '';
  return body ? `${head}: ${body}` : head;
}

/**
 * Maps an error from a content-MUTATING flow run REST call (Run Flow Now or Run
 * Flow Task) into a clear, non-retryable {@link McpToolError}.
 *
 * These endpoints share a small set of failure conditions an LLM would
 * otherwise loop on (re-trying a licensing/permission failure forever). Each
 * message keeps the actionable hint AND, when Tableau returned a structured
 * error body, surfaces Tableau's own `code`/`summary`/`detail` verbatim (the
 * `viewsMethods` convention) so the specific cause is never lost.
 *
 * `verb` is the human phrase for what was attempted, e.g. "run this flow".
 */
export function mapFlowWriteError(error: unknown, verb: string): McpToolError {
  if (error instanceof McpToolError) {
    return error;
  }

  const status = error instanceof Error ? getHttpStatus(error) : '';
  const tableauError = extractTableauError(error);
  // The verbatim Tableau error when present, else the raw exception message.
  const cause = tableauError ? formatTableauError(tableauError) : getExceptionMessage(error);

  // 403: conflates (a) the caller lacking owner/Execute permission, (b) the
  // site missing Data Management / Tableau Prep Conductor, and (c) an admin
  // having disabled the site-wide "Run Now" setting. Name all three.
  if (status === '403') {
    return new McpToolError({
      type: 'flow-write-forbidden',
      statusCode: 403,
      message: [
        `Not permitted to ${verb}.`,
        'This usually means one of:',
        '(1) you are not the flow owner and lack Run Flow / Execute permission;',
        '(2) the site does not have Data Management with Tableau Prep Conductor enabled (required to run or schedule flows);',
        '(3) a site administrator has disabled the "Run Now" setting.',
        cause,
      ].join(' '),
    });
  }

  // 404: flow or task id does not exist (or is not visible to the caller).
  if (status === '404') {
    return new McpToolError({
      type: 'flow-write-not-found',
      statusCode: 404,
      message: [
        `Could not ${verb}: the specified flow or task was not found, or you do not have access to it.`,
        'Verify the id with list-flows / list-flow-tasks.',
        cause,
      ].join(' '),
    });
  }

  // 400 / 409: malformed or rejected request — typically an invalid run mode,
  // missing/invalid required flow parameter override, or a conflicting run.
  if (status === '400' || status === '409') {
    return new McpToolError({
      type: 'flow-write-bad-request',
      statusCode: Number(status),
      message: [
        `Could not ${verb}: the request was rejected as invalid.`,
        'Common causes: an invalid runMode, a missing or invalid required flow parameter override, or a conflicting flow run.',
        cause,
      ].join(' '),
    });
  }

  return new McpToolError({
    type: 'flow-write-failed',
    statusCode: Number(status) || 500,
    message: `Could not ${verb}: ${cause}`,
  });
}

/**
 * Maps an error from Cancel Flow Run into a clear, non-retryable
 * {@link McpToolError}. Cancel has its own distinct failure conditions that the
 * generic {@link mapFlowWriteError} would describe in run-oriented terms, so it
 * is keyed on Tableau's own error `code` (verified against the monolith
 * `RestApiErrorResponseCode`):
 *   - 403136 CANCEL_FLOW_RUNS_DISABLED     — cancel disabled for the site
 *   - 403135 FLOW_RUN_ALREADY_COMPLETE     — nothing to cancel (not retryable)
 *   - 403137 CANCEL_FLOW_RUN_FORBIDDEN     — caller is not the run initiator/admin
 *   - 404036 FLOW_RUN_NOT_FOUND            — no such flow run
 */
export function mapCancelFlowRunError(error: unknown): McpToolError {
  if (error instanceof McpToolError) {
    return error;
  }

  const status = error instanceof Error ? getHttpStatus(error) : '';
  const tableauError = extractTableauError(error);
  const code = tableauError?.code;
  const cause = tableauError ? formatTableauError(tableauError) : getExceptionMessage(error);

  // 403135: the run already finished (Success/Failed/Cancelled) before the
  // cancel arrived. Retrying will never succeed — say so explicitly.
  if (code === '403135') {
    return new McpToolError({
      type: 'cancel-flow-run-already-complete',
      statusCode: 403,
      message: [
        'Could not cancel this flow run: it has already completed, so there is nothing to cancel.',
        'Check the final status with list-flow-runs or get-flow.',
        cause,
      ].join(' '),
    });
  }

  // 403136: an administrator has disabled flow-run cancellation for the site.
  if (code === '403136') {
    return new McpToolError({
      type: 'cancel-flow-run-disabled',
      statusCode: 403,
      message: [
        'Could not cancel this flow run: flow-run cancellation is disabled for this site.',
        'A site or server administrator controls this setting.',
        cause,
      ].join(' '),
    });
  }

  // 403137 (and any other 403): the caller is not permitted to cancel this run.
  // Cancelling requires Run Flow permission AND being the run's initiator, or
  // being a site/server administrator.
  if (code === '403137' || status === '403') {
    return new McpToolError({
      type: 'cancel-flow-run-forbidden',
      statusCode: 403,
      message: [
        'Not permitted to cancel this flow run.',
        'You can cancel a flow run only if you are a site/server administrator, or you initiated the run (or created its scheduled task) and have Run Flow permission on the flow.',
        cause,
      ].join(' '),
    });
  }

  // 404 (404036): the flow run id does not exist or is not visible to the caller.
  if (status === '404') {
    return new McpToolError({
      type: 'cancel-flow-run-not-found',
      statusCode: 404,
      message: [
        'Could not cancel: the specified flow run was not found, or you do not have access to it.',
        'Verify the flow run id with list-flow-runs.',
        cause,
      ].join(' '),
    });
  }

  return new McpToolError({
    type: 'cancel-flow-run-failed',
    statusCode: Number(status) || 500,
    message: `Could not cancel this flow run: ${cause}`,
  });
}
