import { isNativeRedirectUri } from './isNativeRedirectUri.js';
import { matchesRegisteredRedirectUri } from './matchesRegisteredRedirectUri.js';
import { ClientRegistration } from './types.js';

/**
 * Validates that a redirect URI is allowed for the given client.
 *
 * Enforcement policy — **Opaque client_id path** (!clientIdUrl):
 * - Known clients (found in clientRegistrations): `redirectUri` must match one of the
 *   client's stored `redirectUris`.
 * - Unknown clients (not registered / lost on restart): `redirectUri` must pass the
 *   native-only fallback check (loopback http or custom schemes).
 *
 * The CIMD path (clientIdUrl set) enforces its own redirect allowlist in authorize.ts.
 *
 * Returns `null` if the redirect URI is allowed, or an OAuth error object if rejected.
 */
export function checkRedirectUriAllowed(args: {
  clientIdUrl: URL | undefined;
  clientId: string;
  redirectUri: string;
  clientRegistrations: Map<string, ClientRegistration>;
}): { error: string; error_description: string } | null {
  const { clientIdUrl, clientId, redirectUri, clientRegistrations } = args;

  // Single rejection shape reused by every branch below (redirectUri is constant within this call).
  const invalidRedirectError = {
    error: 'invalid_request',
    error_description: `Invalid redirect URI: ${redirectUri}`,
  };

  // Opaque client_id path: enforce per-client allowlist (known) or native-only (unknown)
  if (!clientIdUrl) {
    const registration = clientRegistrations.get(clientId);
    if (registration) {
      // Known client: redirect_uri must match a stored URI
      if (
        !registration.redirectUris.some((uri) => matchesRegisteredRedirectUri(redirectUri, uri))
      ) {
        return invalidRedirectError;
      }
    } else if (!isNativeRedirectUri(redirectUri)) {
      // Unknown client (never registered / lost on restart): native-only fallback
      return invalidRedirectError;
    }
  }

  return null;
}
