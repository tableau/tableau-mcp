import { TableauAgentNotEnabledError } from '../../../errors/mcpToolError.js';
import { isAxiosError } from '../../../utils/axios.js';

/**
 * Turns CES's 403 into a typed error. Without this, `WebTool` reports a raw 403 as a generic
 * sign-in/permissions problem, which sends the client down the wrong path.
 */
export function asTableauAgentNotEnabledError(
  error: unknown,
): TableauAgentNotEnabledError | undefined {
  if (isAxiosError(error) && error.response?.status === 403) {
    return new TableauAgentNotEnabledError();
  }
  return undefined;
}
