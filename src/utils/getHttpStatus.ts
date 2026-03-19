import { PulseDisabledError } from '../sdks/tableau/methods/pulseMethods.js';
import { isAxiosError } from './axios.js';

/**
 * Extracts HTTP status code from an error if available (e.g., "401", "404", "500")
 * Returns empty string if no HTTP status can be determined
 */
export function getHttpStatus(error: Error): string {
  // Check if the error itself is an AxiosError
  if (isAxiosError(error) && error.response?.status) {
    return String(error.response.status);
  }
  // Check if the error is a PulseDisabledError
  if (error instanceof PulseDisabledError) {
    return String(error.httpStatus);
  }
  // Check if the error wraps an AxiosError in its cause (e.g., ZodiosError)
  if (error.cause && isAxiosError(error.cause) && error.cause.response?.status) {
    return String(error.cause.response.status);
  }
  return '';
}
