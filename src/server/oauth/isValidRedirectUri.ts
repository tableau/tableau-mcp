import { LOOPBACK_HOSTS } from './loopbackHosts.js';

export function isValidRedirectUri(redirectUri: unknown): boolean {
  if (typeof redirectUri !== 'string') {
    return false;
  }

  try {
    const url = new URL(redirectUri);

    // Allow HTTPS URLs
    if (url.protocol === 'https:') {
      return true;
    }

    // Allow HTTP only for loopback hosts (RFC 8252 §7.3).
    if (url.protocol === 'http:') {
      return LOOPBACK_HOSTS.has(url.hostname);
    }

    // Allow custom schemes (like systemprompt://)
    if (url.protocol.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:$/)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
