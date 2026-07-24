import { McpToolError } from '../errors/mcpToolError.js';
import { TableauRestError } from '../sdks/tableau/tableauRestError.js';
import { isAxiosError } from './axios.js';

/**
 * Extracts HTTP status code from an error if available
 * Returns empty string if no HTTP status can be determined
 */
export function getHttpStatus(error: Error): string {
  // Check if the error itself is an AxiosError
  if (isAxiosError(error) && error.response?.status) {
    return String(error.response.status);
  }
  // Check if the error is a McpToolError
  if (error instanceof McpToolError) {
    return String(error.statusCode);
  }
  // Tableau error returned inside a 2xx body (status derived from the code).
  if (error instanceof TableauRestError) {
    return error.statusCode;
  }
  // Check if the error wraps an AxiosError in its cause (e.g., ZodiosError)
  if (error.cause && isAxiosError(error.cause) && error.cause.response?.status) {
    return String(error.cause.response.status);
  }
  return '';
}
