import { Err } from 'ts-results-es';

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
