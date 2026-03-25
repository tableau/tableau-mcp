import { McpToolError } from './McpToolError.js';

export class QueryValidationError extends McpToolError {
  constructor(message: string) {
    super('query-validation', message, 400);
  }
}
