import { McpToolError } from './McpToolError.js';

export class ArgsValidationError extends McpToolError {
  constructor(message: string) {
    super('args-validation', message, 400);
  }
}
