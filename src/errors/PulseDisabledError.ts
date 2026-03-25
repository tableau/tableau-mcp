import { getPulseDisabledError } from '../tools/pulse/getPulseDisabledError.js';
import { McpToolError } from './McpToolError.js';

export class PulseDisabledError extends McpToolError {
  constructor() {
    super('pulse-disabled', 'Pulse is disabled', 400);
  }

  override getErrorText(): string {
    return getPulseDisabledError(this.type);
  }
}
