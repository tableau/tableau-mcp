import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

export class McpToolError extends Error {
  readonly type: string;
  readonly statusCode: number;
  readonly internalStatusCode?: number;
  readonly internalError?: string;
  readonly internalErrorDetails?: string;

  constructor(
    type: string,
    message: string,
    statusCode: number,
    // internal error is any underlying error caused by dependencies
    internalStatusCode?: number,
    internalError?: string,
    internalErrorDetails?: string,
  ) {
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
    super('args-validation', message, 400);
  }
}

export class DatasourceNotAllowedError extends McpToolError {
  constructor(message: string) {
    super('datasource-not-allowed', message, 403);
  }
}

export class FeatureDisabledError extends McpToolError {
  constructor(message: string) {
    super('feature-disabled', message, 404);
  }
}

export class PulseDisabledError extends McpToolError {
  constructor() {
    super('pulse-disabled', 'Pulse is disabled', 400);
  }

  override getErrorText(): string {
    return 'Pulse is disabled on this Tableau Cloud site. To enable Pulse, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}

export class PulseNotAvailableError extends McpToolError {
  constructor() {
    super('tableau-server', 'Pulse not available on Tableau Server', 404);
  }

  override getErrorText(): string {
    return 'Pulse is not available on Tableau Server. Consider disabling the Pulse MCP tools in your client or removing them using the EXCLUDE_TOOLS environment variable. To enable Pulse on your Tableau Cloud site, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}

export class QueryValidationError extends McpToolError {
  constructor(message: string) {
    super('query-validation', message, 400);
  }
}

export class ViewNotAllowedError extends McpToolError {
  constructor(message: string) {
    super('view-not-allowed', message, 403);
  }
}

export class WorkbookNotAllowedError extends McpToolError {
  constructor(message: string) {
    super('workbook-not-allowed', message, 403);
  }
}

export class ZodiosValidationError extends McpToolError {
  constructor(error: ZodiosError) {
    super(
      'zodios-error',
      error.message,
      400,
      undefined,
      error.data?.toString(),
      fromError(error.cause).toString(),
    );
  }
}
