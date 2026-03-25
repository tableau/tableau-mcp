import { McpToolError } from './McpToolError.js';

export class PulseDisabledError extends McpToolError {
  constructor() {
    super('pulse-disabled', 'Pulse is disabled', 400);
  }

  override getErrorText(): string {
    return 'Pulse is disabled on this Tableau Cloud site. To enable Pulse, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}
