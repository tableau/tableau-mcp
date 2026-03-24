export class TableauMCPError extends Error {
  readonly type: string;
  readonly statusCode: number;
  readonly internalStatusCode?: number;
  readonly internalError?: string;
  readonly internalErrorDetails?: string;

  constructor(
    type: string,
    message: string,
    statusCode: number,
    // internal error is any underyling error caused by dependencies
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
}

/**
 * Factory functions for creating standardized TableauMCPError instances.
 * Use these instead of `new TableauMCPError(...)` to ensure consistent types,
 * messages, and status codes across the codebase.
 */
export const TableauMCPErrorFactory = {
  // Fixed errors — no parameters needed
  pulseNotAvailable: (): TableauMCPError =>
    new TableauMCPError('tableau-server', 'Pulse not available on Tableau Server', 404),
  pulseDisabled: (): TableauMCPError =>
    new TableauMCPError('pulse-disabled', 'Pulse is disabled', 400),

  // Parameterized errors — message varies by context
  featureDisabled: (message: string): TableauMCPError =>
    new TableauMCPError('feature-disabled', message, 404),
  datasourceNotAllowed: (message: string): TableauMCPError =>
    new TableauMCPError('datasource-not-allowed', message, 403),
  viewNotAllowed: (message: string): TableauMCPError =>
    new TableauMCPError('view-not-allowed', message, 403),
  workbookNotAllowed: (message: string): TableauMCPError =>
    new TableauMCPError('workbook-not-allowed', message, 403),
  queryValidation: (message: string): TableauMCPError =>
    new TableauMCPError('query-validation', message, 400),
  argsValidation: (message: string): TableauMCPError =>
    new TableauMCPError('args-validation', message, 400),
};
