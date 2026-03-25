import { McpToolError } from './McpToolError.js';

export class FeatureDisabledError extends McpToolError {
  constructor(message: string) {
    super('feature-disabled', message, 404);
  }
}
