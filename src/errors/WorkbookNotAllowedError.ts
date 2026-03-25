import { McpToolError } from './McpToolError.js';

export class WorkbookNotAllowedError extends McpToolError {
  constructor(message: string) {
    super('workbook-not-allowed', message, 403);
  }
}
