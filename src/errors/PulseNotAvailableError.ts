import { getPulseDisabledError } from '../tools/pulse/getPulseDisabledError.js';
import { McpToolError } from './McpToolError.js';

export class PulseNotAvailableError extends McpToolError {
  constructor() {
    super('tableau-server', 'Pulse not available on Tableau Server', 404);
  }

  override getErrorText(): string {
    return getPulseDisabledError(this.type);
  }
}
