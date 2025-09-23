import { createHash } from 'crypto';

/**
 * Generates PKCE code challenge from verifier
 *
 * @remarks
 * Uses SHA256 hashing as required by S256 method
 *
 * @param verifier - Random code verifier string
 * @returns Base64url-encoded SHA256 hash of verifier
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
