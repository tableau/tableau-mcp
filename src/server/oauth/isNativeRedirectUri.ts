import { LOOPBACK_HOSTS } from './loopbackHosts.js';

/**
 * Returns true iff `redirectUri` is a native redirect URI suitable for
 * fallback when an opaque client_id is unknown (not registered).
 *
 * Native-only fallback policy:
 * - Loopback http: localhost, 127.0.0.1, [::1]
 * - Custom schemes: e.g. cursor://, vscode://
 * - Reject: remote https, remote http, non-URLs
 *
 * This is the narrowed check used ONLY in the opaque unknown-client path.
 * CIMD clients and the baseline isValidRedirectUri check are unaffected.
 */
export function isNativeRedirectUri(redirectUri: unknown): boolean {
  if (typeof redirectUri !== 'string') {
    return false;
  }

  try {
    const url = new URL(redirectUri);

    // Allow HTTP only for loopback hosts (RFC 8252 §7.3).
    if (url.protocol === 'http:') {
      return LOOPBACK_HOSTS.has(url.hostname);
    }

    // Reject remote https (and all other https)
    if (url.protocol === 'https:') {
      return false;
    }

    // Allow custom schemes (like cursor://, vscode://, systemprompt://)
    if (url.protocol.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:$/)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
