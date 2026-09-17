import { McpToolError } from '../../../errors/mcpToolError.js';
import { TableauRestError } from '../../../sdks/tableau/tableauRestError.js';
import { isAxiosError } from '../../../utils/axios.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';

/** Extracts Tableau's structured error envelope, including one returned in a 2xx response. */
export function extractTableauError(
  error: unknown,
): { code?: string; summary?: string; detail?: string } | null {
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
    | {
        code?: string;
        summary?: string;
        detail?: string;
      }
    | undefined;
  if (tableauError && (tableauError.summary || tableauError.code)) {
    return tableauError;
  }
  return null;
}

/** Format `{ code, summary, detail }` as `Tableau [code]: summary: detail`. */
export function formatTableauError(t: {
  code?: string;
  summary?: string;
  detail?: string;
}): string {
  const head = `Tableau${t.code ? ` [${t.code}]` : ''}`;
  const body = t.detail && t.summary ? `${t.summary}: ${t.detail}` : t.summary || t.detail || '';
  return body ? `${head}: ${body}` : head;
}

/** Maps flow-run mutation errors to actionable MCP errors. */
export function mapFlowWriteError(error: unknown, verb: string): McpToolError {
  if (error instanceof McpToolError) {
    return error;
  }

  const status = error instanceof Error ? getHttpStatus(error) : '';
  const tableauError = extractTableauError(error);
  const cause = tableauError ? formatTableauError(tableauError) : getExceptionMessage(error);

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

/** Maps Cancel Flow Run's Tableau error codes to actionable MCP errors. */
export function mapCancelFlowRunError(error: unknown): McpToolError {
  if (error instanceof McpToolError) {
    return error;
  }

  const status = error instanceof Error ? getHttpStatus(error) : '';
  const tableauError = extractTableauError(error);
  const code = tableauError?.code;
  const cause = tableauError ? formatTableauError(tableauError) : getExceptionMessage(error);

  // 403135: the run is already terminal, so retrying cannot help.
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

  // 403136: cancellation is disabled for this site.
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

  // 403137 and other 403s: the caller cannot cancel this run.
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

  // 404 (404036): the run does not exist or is not visible.
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
