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
