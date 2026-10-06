import { McpToolError } from '../errors/mcpToolError.js';
import { TableauRestError } from '../sdks/tableau/tableauRestError.js';
import { isAxiosError } from './axios.js';

/**
 * Extracts HTTP status code from an error if available
 * Returns empty string if no HTTP status can be determined
 */
export function getHttpStatus(error: Error): string {
  const visited = new Set<object>();
  let current: unknown = error;
  while (current !== null && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (isAxiosError(current) && current.response?.status) {
      return String(current.response.status);
    }
    if (current instanceof McpToolError) {
      return String(current.statusCode);
    }
    if (current instanceof TableauRestError) {
      return current.statusCode;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return '';
}
