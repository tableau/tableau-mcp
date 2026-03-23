/** Default header clients send so the server can verify JWT_SUB_CLAIM_HEADER requests. */
export const DEFAULT_JWT_SUB_SECRET_HEADER = 'x-tableau-mcp-jwt-sub-secret';

export function isSafeHttpHeaderName(name: string): boolean {
  return name.length > 0 && name.length <= 256 && /^[!#$%&'*+.^_|~0-9a-z-]+$/i.test(name);
}
