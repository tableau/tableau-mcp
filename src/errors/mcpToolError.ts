import { ZodiosError } from '@zodios/core';
import { Err } from 'ts-results-es';
import { fromError } from 'zod-validation-error/v3';

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
