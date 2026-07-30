import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import {
  BARE_COMMAND_FAILURE_GUIDANCE,
  isBareCommandFailure,
} from '../desktop/commands/workbook/applyFailureClassifier.js';
import type { GetDashboardXmlError } from '../desktop/commands/workbook/getDashboardXml.js';
import type { GetWorksheetXmlError } from '../desktop/commands/workbook/getWorksheetXml.js';
import type { LoadDashboardXmlError } from '../desktop/commands/workbook/loadDashboardXml.js';
import type { LoadWorkbookXmlError } from '../desktop/commands/workbook/loadWorkbookXml.js';
import type { LoadWorksheetXmlError } from '../desktop/commands/workbook/loadWorksheetXml.js';
import { ExecuteCommandError } from '../desktop/toolExecutor/toolExecutor.js';
import {
  type StructuredResult,
  type WireStructuredContent,
  wireStructuredContent,
} from '../tools/desktop/structuredContent.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';

// Load XML errors preserve Desktop's message when present; otherwise serialize structural errors.
function xmlLoadErrorMessage(
  error: LoadWorkbookXmlError | LoadWorksheetXmlError | LoadDashboardXmlError,
): string {
  return 'message' in error && typeof error.message === 'string'
    ? error.message
    : JSON.stringify(error);
}

export class McpToolError extends Error {
  readonly type: string;
  readonly statusCode: number;
  readonly internalStatusCode?: number;
  readonly internalError?: string;
  readonly internalErrorDetails?: string;

  constructor({
    type,
    message,
    statusCode,
    // internal error is any underlying error caused by dependencies
    internalStatusCode,
    internalError,
    internalErrorDetails,
  }: {
    type: string;
    message: string;
    statusCode: number;
    internalStatusCode?: number;
    internalError?: string;
    internalErrorDetails?: string;
  }) {
    super(message);
    this.type = type;
    this.statusCode = statusCode;
    this.internalStatusCode = internalStatusCode;
    this.internalError = internalError;
    this.internalErrorDetails = internalErrorDetails;
  }

  getErrorText(): string {
    return this.message;
  }

  toErr(): Err<this> {
    return new Err(this);
  }
}

/**
 * Signals that a multi-step operation did not fully complete while preserving
 * the complete machine-readable recovery payload in the MCP error body.
 */
export class IncompleteOperationError<T extends object> extends McpToolError {
  readonly structuredContent?: WireStructuredContent;
  private readonly recoveryPayload: StructuredResult<T>;

  constructor(recoveryPayload: StructuredResult<T>) {
    super({
      type: 'incomplete-operation',
      message: 'The requested operation did not complete.',
      statusCode: 409,
    });
    this.recoveryPayload = recoveryPayload;
    const { structuredContent, ...body } = recoveryPayload;
    // A client that prefers structuredContent never reads getErrorText() below, so the
    // recovery payload has to ride in the block too — otherwise the agent is told only
    // "do this next" with no record of which asks failed or how far the operation got.
    this.structuredContent = structuredContent
      ? wireStructuredContent(body, structuredContent)
      : undefined;
  }

  override getErrorText(): string {
    const { structuredContent: _, ...body } = this.recoveryPayload;
    return JSON.stringify(body);
  }
}

export class ArgsValidationError extends McpToolError {
  constructor(message: string) {
    super({ type: 'args-validation', message, statusCode: 400 });
  }
}

export class DatasourceNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'datasource-not-allowed', message, statusCode: 403 });
  }
}

// Thrown by the two-phase delete tools when a confirmed delete (`confirm: true`) is requested but the
// target resource is not carrying the pending-deletion tag. The tag is server-side state set by a
// prior, distinct preview call, so its presence — verified by a fresh re-fetch — is the authoritative
// proof that a preview actually ran. Unlike a caller-computable confirmation token, this gate cannot
// be bypassed by deriving a value: the caller has no way to mark the resource as pending deletion
// other than by running the preview phase. statusCode 409: a required precondition/state is missing.
export class PreviewNotRunError extends McpToolError {
  constructor(message: string) {
    super({ type: 'preview-not-run', message, statusCode: 409 });
  }
}

export class FeatureDisabledError extends McpToolError {
  constructor(message: string) {
    super({ type: 'feature-disabled', message, statusCode: 404 });
  }
}

export class FlowNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'flow-not-allowed', message, statusCode: 403 });
  }
}

export class PulseDisabledError extends McpToolError {
  constructor() {
    super({ type: 'pulse-disabled', message: 'Pulse is disabled', statusCode: 400 });
  }

  override getErrorText(): string {
    return 'Pulse is disabled on this Tableau Cloud site. To enable Pulse, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}

export class PulseInsightsDisabledError extends McpToolError {
  constructor() {
    super({
      type: 'pulse-insights-disabled',
      message: 'Pulse AI insights are disabled',
      statusCode: 403,
    });
  }

  override getErrorText(): string {
    return 'AI-powered Pulse insights are not enabled on this Tableau Cloud site. This feature requires Tableau+ to be enabled by a site administrator.';
  }
}

export class PulseNotAvailableError extends McpToolError {
  constructor() {
    super({
      type: 'tableau-server',
      message: 'Pulse not available on Tableau Server',
      statusCode: 404,
    });
  }

  override getErrorText(): string {
    return 'Pulse is not available on Tableau Server. Consider disabling the Pulse MCP tools in your client or removing them using the EXCLUDE_TOOLS environment variable. To enable Pulse on your Tableau Cloud site, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}

export class QueryValidationError extends McpToolError {
  constructor(message: string) {
    super({ type: 'query-validation', message, statusCode: 400 });
  }
}

export class PulseInsightsApiError extends McpToolError {
  constructor(message: string, statusCode: number, errorCode?: string, details?: string) {
    super({
      type: 'pulse-insights-api-error',
      message,
      statusCode,
      internalStatusCode: statusCode,
      internalError: errorCode,
      internalErrorDetails: details,
    });
  }
}

export class EmbedTokenNotAvailableError extends McpToolError {
  constructor() {
    super({
      type: 'embed-token-not-available',
      message: 'Failed to get an embed token for the current authentication configuration.',
      statusCode: 500,
    });
  }
}

export class ViewNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'view-not-allowed', message, statusCode: 403 });
  }
}

export class CustomViewNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'custom-view-not-allowed', message, statusCode: 403 });
  }
}

export class WorkbookNotAllowedError extends McpToolError {
  constructor(message: string) {
    super({ type: 'workbook-not-allowed', message, statusCode: 403 });
  }
}

export class WorkbookNotFoundError extends McpToolError {
  constructor(message: string) {
    super({ type: 'workbook-not-found', message, statusCode: 404 });
  }
}

export class WorksheetNotFoundError extends McpToolError {
  constructor(message: string) {
    super({ type: 'worksheet-not-found', message, statusCode: 404 });
  }
}

export class ZodiosValidationError extends McpToolError {
  constructor(error: ZodiosError) {
    super({
      type: 'zodios-error',
      message: error.message,
      statusCode: 400,
      internalError: error.data?.toString(),
      internalErrorDetails: fromError(error.cause).toString(),
    });
  }
}

export class ServiceUnavailableError extends McpToolError {
  constructor(message: string) {
    super({ type: 'service-unavailable', message, statusCode: 503 });
  }
}

export class UnknownError extends McpToolError {
  constructor(message: string, statusCode = 500) {
    super({ type: 'unknown', message, statusCode });
  }
}

export class NoDesktopInstancesFoundError extends McpToolError {
  constructor() {
    super({
      type: 'no-desktop-instances-found',
      message: [
        'No running Tableau Desktop instances found.',
        'Make sure:',
        '  1. Tableau Desktop is running',
        '  2. The External Client API is available in this Desktop build',
        '  3. The External Client API discovery file exists in the expected location',
      ].join('\n'),
      statusCode: 404,
    });
  }
}

export class GetEventsFailedError extends McpToolError {
  constructor(error: unknown) {
    super({
      type: 'get-events-failed',
      message: [
        `Failed to get events: ${getExceptionMessage(error)}.`,
        'Make sure:',
        '  1. Tableau Desktop is running',
        '  2. The Desktop events endpoint is available',
      ].join('\n'),
      statusCode: 500,
    });
  }
}

export class AdminOnlyError extends McpToolError {
  constructor(message: string) {
    super({ type: 'admin-only', message, statusCode: 403 });
  }
}

export class AdminInsightsUnavailableError extends McpToolError {
  constructor(message: string) {
    super({ type: 'admin-insights-unavailable', message, statusCode: 404 });
  }
}

/**
 * The image-render call exceeded its deadline. Distinct from client cancellation: the render
 * hangs indefinitely when Tableau Desktop is showing a modal dialog that blocks rendering, so
 * a blind retry just wedges Desktop again. The message steers toward dismissing the dialog or
 * passing a filePath rather than retrying.
 */
export class ImageExportTimeoutError extends McpToolError {
  constructor(label: string, timeoutMs: number) {
    const seconds = Math.round(timeoutMs / 1000);
    super({
      type: 'image-export-timeout',
      message: [
        `${label} image export exceeded ${seconds}s and was aborted.`,
        'Tableau Desktop may be showing a modal dialog (e.g. a save or error prompt) that ' +
          'blocks rendering. Do not blindly retry — it will hang again.',
        'Bring Tableau Desktop to the foreground and dismiss any open dialog, or pass a ' +
          'filePath so Tableau writes the image to disk directly.',
      ].join('\n'),
      statusCode: 504,
    });
  }
}

export class DesktopCommandExecutionError extends McpToolError {
  constructor(error: ExecuteCommandError, fix?: string) {
    const message = formatDesktopCommandExecutionError(error);
    super({
      type: 'desktop-command-execution-error',
      message: fix ? `${message}\n${fix}` : message,
      statusCode: 500,
    });
  }
}

function formatDesktopCommandExecutionError(error: ExecuteCommandError): string {
  if (error.type !== 'command-failed') {
    return JSON.stringify(error);
  }

  const commandError = error.error;
  const message = commandError?.message;
  if (!message) {
    return JSON.stringify(error);
  }

  const tableauErrorCode = commandError['tableau-error-code'];
  const formattedMessage =
    typeof tableauErrorCode === 'string' && tableauErrorCode.length > 0
      ? `${message}\ntableau-error-code: ${tableauErrorCode}`
      : message;
  return isBareCommandFailure(message)
    ? `${formattedMessage}\n${BARE_COMMAND_FAILURE_GUIDANCE}`
    : formattedMessage;
}

export class WorkbookXmlLoadFailedError extends McpToolError {
  constructor(error: LoadWorkbookXmlError) {
    super({
      type: 'load-workbook-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}

export class WorksheetXmlLoadFailedError extends McpToolError {
  constructor(error: LoadWorksheetXmlError) {
    super({
      type: 'load-worksheet-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}

export class GetWorksheetXmlFailedError extends McpToolError {
  constructor(error: GetWorksheetXmlError) {
    super({
      type: 'get-worksheet-xml-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
}

export class GetDashboardXmlFailedError extends McpToolError {
  constructor(error: GetDashboardXmlError) {
    super({
      type: 'get-dashboard-xml-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
}

export class DashboardXmlLoadFailedError extends McpToolError {
  constructor(error: LoadDashboardXmlError) {
    super({
      type: 'load-dashboard-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}

// A storyboard serializes as a `<dashboard type='storyboard'>`, so it shares the dashboard load
// path and its error shape; only the error `type` differs so the agent sees a storyboard-scoped
// failure rather than a misleading dashboard one.
export class StoryboardXmlLoadFailedError extends McpToolError {
  constructor(error: LoadDashboardXmlError) {
    super({
      type: 'load-storyboard-xml-error',
      message: xmlLoadErrorMessage(error),
      statusCode: 500,
    });
  }
}

export class FileReadError extends McpToolError {
  constructor(error: unknown) {
    super({
      type: 'file-read-error',
      message: `Failed to read file: ${getExceptionMessage(error)}. Make sure the file exists and is readable.`,
      statusCode: 500,
    });
  }
}

export class FileNotFoundError extends McpToolError {
  constructor(filePath: string) {
    super({
      type: 'file-not-found',
      message: `File not found: ${filePath}. Make sure the path was returned from the appropriate get-*-xml tool.`,
      statusCode: 404,
    });
  }
}

export class XmlModificationError extends McpToolError {
  constructor(message: string) {
    super({ type: 'xml-modification-error', message, statusCode: 422 });
  }
}

/**
 * Refuse to apply a cache file whose instance fingerprint does not match the current
 * Desktop session (cross-instance cache bleed, W9). `message` carries the recovery recipe.
 */
export class CacheSessionMismatchError extends McpToolError {
  constructor(message: string) {
    super({ type: 'cache-session-mismatch', message, statusCode: 409 });
  }
}

export class XmlValidationError extends McpToolError {
  constructor(errors: string[]) {
    const errorList = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
    super({
      type: 'xml-validation-error',
      message: `Modified XML failed validation with ${errors.length} error(s):\n\n${errorList}\n\nThis is likely a bug in the MCP. Please report this issue.`,
      statusCode: 422,
    });
  }
}
