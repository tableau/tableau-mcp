import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

import { LoadWorkbookXmlError } from '../desktop/commands/workbook/loadWorkbookXml.js';
import { ExecuteCommandError } from '../desktop/toolExecutor/toolExecutor.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';

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

const PULSE_INSIGHTS_ERROR_GUIDANCE: Record<string, string> = {
  '400712':
    'Missing measure or measure field name. Ensure basic_specification.measure.field is a non-empty string.',
  '400713':
    'Unknown or missing measure aggregation. Set basic_specification.measure.aggregation to a valid value (e.g., AGGREGATION_SUM, AGGREGATION_AVERAGE, AGGREGATION_USER).',
  '400714':
    'Missing time dimension or time dimension field name. Ensure basic_specification.time_dimension.field is set.',
  '400732':
    'Invalid measurement period. Check that the date format is YYYY-MM-DD and that start/end dates are valid.',
  '400734': 'Invalid offset_from_today. Value must be between 0 and 365 inclusive.',
  '400940': 'Invalid filter: missing field name or unknown/unspecified operator.',
  '400941':
    'Invalid filter values: no values provided, or mixed string and boolean data types in the same filter.',
  '400945':
    'No measurement period present. Set metric_specification.measurement_period with both granularity and range.',
  '400946':
    'No granularity specified. Set measurement_period.granularity (e.g., GRANULARITY_BY_DAY, GRANULARITY_BY_WEEK, GRANULARITY_BY_MONTH).',
  '400947':
    'No range specified. Set measurement_period.range (e.g., RANGE_CURRENT_PARTIAL, RANGE_LAST_COMPLETE).',
  '400948':
    'No comparison config present. Set metric_specification.comparison with a valid comparison type.',
  '400949':
    'No comparison type specified, or BY_CONFIG comparison is missing the required specific_comparison config.',
  '400955': 'AI-powered insights (GAI) is not enabled for this site.',
  '400958': 'Missing or incorrectly formatted field ID in field values request.',
  '400960': 'Field ID not set in the request.',
  '400969': 'Conflicting options: is_running_total cannot be true when is_summable is false.',
  '400970': 'Unsupported field type for the requested operation.',
  '400971':
    'Unknown definition specification type. Use either basic_specification, abstract_query_specification, or viz_state_specification.',
  '400972': 'Time dimension must be absent when both range and comparison are unspecified.',
  '400000':
    'General validation error. Check that: version is 1, at least one metric is provided, all metric keys are unique and non-empty, and input counts are within limits.',
  '404936': 'Missing datasource ID or definition specification.',
};

export class PulseInsightsApiError extends McpToolError {
  constructor(statusCode: number, responseData: unknown) {
    const { errorCode, tabCode, guidance } = PulseInsightsApiError.parseResponse(responseData);

    const parts: string[] = [];
    parts.push(`Pulse Insights API returned HTTP ${statusCode}.`);
    if (errorCode) parts.push(`Error code: ${errorCode}.`);
    if (guidance) {
      parts.push(guidance);
    } else if (tabCode) {
      parts.push(`TabCode: ${tabCode}. Check the Pulse Insights API documentation for details.`);
    }

    super({
      type: 'pulse-insights-api-error',
      message: parts.join(' '),
      statusCode,
      internalStatusCode: statusCode,
      internalError: errorCode ?? undefined,
      internalErrorDetails:
        typeof responseData === 'object'
          ? JSON.stringify(responseData)
          : String(responseData ?? ''),
    });
  }

  override getErrorText(): string {
    return this.message;
  }

  private static parseResponse(data: unknown): {
    errorCode: string | null;
    tabCode: string | null;
    guidance: string | null;
  } {
    if (data == null || typeof data !== 'object') {
      return { errorCode: null, tabCode: null, guidance: null };
    }

    const obj = data as Record<string, unknown>;
    const errorCode = typeof obj.code === 'string' ? obj.code : null;
    const tabCode = typeof obj.message === 'string' ? obj.message : null;

    let guidance: string | null = null;
    if (errorCode && errorCode in PULSE_INSIGHTS_ERROR_GUIDANCE) {
      guidance = PULSE_INSIGHTS_ERROR_GUIDANCE[errorCode];
    }

    return { errorCode, tabCode, guidance };
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
      message: JSON.stringify(error),
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
