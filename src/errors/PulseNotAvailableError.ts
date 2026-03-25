import { McpToolError } from './McpToolError.js';

export class PulseNotAvailableError extends McpToolError {
  constructor() {
    super('tableau-server', 'Pulse not available on Tableau Server', 404);
  }

  override getErrorText(): string {
    return 'Pulse is not available on Tableau Server. Consider disabling the Pulse MCP tools in your client or removing them using the EXCLUDE_TOOLS environment variable. To enable Pulse on your Tableau Cloud site, please see the instructions at https://help.tableau.com/current/online/en-us/pulse_set_up.htm.';
  }
}
