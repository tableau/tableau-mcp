import { isAxiosError } from './axios.js';

/** Recognize explicit OAuth scope errors, never a bare 403 or free-form error message. */
export function isInsufficientScopeError(error: unknown): boolean {
  const visited = new Set<Error>();
  while (error instanceof Error && !visited.has(error)) {
    visited.add(error);
    if (isAxiosError(error) && error.response?.status === 403) {
      const { data, headers } = error.response;
      if (data?.error === 'insufficient_scope') return true;

      const challenge = headers?.['www-authenticate'] ?? headers?.['WWW-Authenticate'];
      if (typeof challenge === 'string' && hasInsufficientScopeChallenge(challenge)) return true;
    }
    error = error.cause;
  }
  return false;
}

function hasInsufficientScopeChallenge(challenge: string): boolean {
  const bearer = /^Bearer\s+/i.exec(challenge.trim());
  if (!bearer) return false;
  let remaining = challenge.trim().slice(bearer[0].length);
  // Consume whole parameters so text inside a quoted description cannot act as an error code.
  while (remaining) {
    const parameter = /^([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s,"]+)\s*(?:,\s*|$)/.exec(remaining);
    if (!parameter) return false;
    const [, name, value] = parameter;
    if (name.toLowerCase() === 'error') {
      return value === 'insufficient_scope' || value === '"insufficient_scope"';
    }
    remaining = remaining.slice(parameter[0].length);
  }
  return false;
}
