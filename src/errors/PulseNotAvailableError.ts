import { McpToolError } from './McpToolError.js';

export class PulseNotAvailableError extends McpToolError {
  constructor() {
    super('tableau-server', 'Pulse not available on Tableau Server', 404);
  }
}
