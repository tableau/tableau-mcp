import { McpToolError } from './McpToolError.js';

export class DatasourceNotAllowedError extends McpToolError {
  constructor(message: string) {
    super('datasource-not-allowed', message, 403);
  }
}
