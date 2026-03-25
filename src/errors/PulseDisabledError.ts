import { McpToolError } from './McpToolError.js';

export class PulseDisabledError extends McpToolError {
  constructor() {
    super('pulse-disabled', 'Pulse is disabled', 400);
  }
}
