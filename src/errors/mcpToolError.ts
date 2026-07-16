import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import type { GetDashboardXmlError } from '../desktop/commands/workbook/getDashboardXml.js';
import type { GetWorksheetXmlError } from '../desktop/commands/workbook/getWorksheetXml.js';
import type { LoadDashboardXmlError } from '../desktop/commands/workbook/loadDashboardXml.js';
import type { LoadWorkbookXmlError } from '../desktop/commands/workbook/loadWorkbookXml.js';
import type { LoadWorksheetXmlError } from '../desktop/commands/workbook/loadWorksheetXml.js';
import { ExecuteCommandError } from '../desktop/toolExecutor/toolExecutor.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';

// The load-*-xml error union carries Desktop's own rejection text on its message-bearing
// variants (load-rejected / readback-failed), already formatted for the agent by
// applyFailureClassifier. Surface that text directly instead of JSON.stringify-wrapping it;
// fall back to JSON only for the structural variants that carry no message string.
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
        '  2. Agent API is enabled',
        '  3. The manifest file exists in the expected location',
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
        '  2. Agent API is enabled',
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

export class DesktopCommandExecutionError extends McpToolError {
  constructor(error: ExecuteCommandError) {
    super({
      type: 'desktop-command-execution-error',
      message: JSON.stringify(error),
      statusCode: 500,
    });
  }
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
