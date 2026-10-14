import type { SessionStore } from '../../sessionStore/sessionStore.js';
import { isNativeRedirectUri } from './isNativeRedirectUri.js';
import { matchesRegisteredRedirectUri } from './matchesRegisteredRedirectUri.js';
import { ClientRegistration } from './types.js';

/**
 * Validates that an opaque (non-URL) client's redirect URI is allowed.
 *
 * Call this only for opaque client_ids — the CIMD path (URL client_id) enforces its
 * own redirect allowlist in authorize.ts and must not be routed through here.
 *
 * Enforcement policy:
 * - Known clients (found in clientRegistrations): `redirectUri` must match one of the
 *   client's stored `redirectUris`.
 * - Unknown clients (not registered / lost on restart): `redirectUri` must pass the
 *   native-only fallback check (loopback http or custom schemes).
 *
 * Returns `null` if the redirect URI is allowed, or an OAuth error object if rejected.
 */
export async function checkRedirectUriAllowed(args: {
  clientId: string;
  redirectUri: string;
  clientRegistrations: SessionStore<ClientRegistration>;
}): Promise<{ error: string; error_description: string } | null> {
  const { clientId, redirectUri, clientRegistrations } = args;

  // Single rejection shape reused by every branch below (redirectUri is constant within this call).
  const invalidRedirectError = {
    error: 'invalid_request',
    error_description: `Invalid redirect URI: ${redirectUri}`,
  };

  const registration = await clientRegistrations.get(clientId);
  if (registration) {
    // Known client: redirect_uri must match a stored URI
    if (!registration.redirectUris.some((uri) => matchesRegisteredRedirectUri(redirectUri, uri))) {
      return invalidRedirectError;
    }
  } else if (!isNativeRedirectUri(redirectUri)) {
    // Unknown client (never registered / lost on restart): native-only fallback
    return invalidRedirectError;
  }

  return null;
}
