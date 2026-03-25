import { McpToolError } from './McpToolError.js';

export class ViewNotAllowedError extends McpToolError {
  constructor(message: string) {
    super('view-not-allowed', message, 403);
  }
}
