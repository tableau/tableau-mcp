export function isValidRedirectUri(redirectUri: any): boolean {
  if (typeof redirectUri !== 'string') {
    return false;
  }

  try {
    const url = new URL(redirectUri);

    // Allow HTTPS URLs
    if (url.protocol === 'https:') {
      return true;
    }

    // Allow HTTP only for localhost
    if (url.protocol === 'http:') {
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
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
