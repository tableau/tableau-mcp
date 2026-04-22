// Node's URL parser keeps IPv6 hostnames bracketed (e.g. '[::1]').
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * Returns true iff `requestUri` should be considered equal to `registeredUri`
 * for the purposes of OAuth redirect URI matching.
 *
 * Default behavior is exact string match. As a narrow exception, RFC 8252
 * section 7.3 requires authorization servers to allow any port for loopback
 * IP redirect URIs, so that native clients can bind to an ephemeral port at
 * request time. We honor that by relaxing the port comparison when both URIs
 * are `http:` and share the exact same loopback host. Every other component
 * (scheme, host, path, query, fragment, userinfo) must still match exactly.
 *
 * Host equivalence is intentionally exact (`127.0.0.1` != `localhost` != `[::1]`)
 * to avoid DNS-resolution surprises and to keep the relaxation narrow.
 */
export function matchesRegisteredRedirectUri(requestUri: string, registeredUri: string): boolean {
  if (requestUri === registeredUri) {
    return true;
  }

  let req: URL;
  let reg: URL;
  try {
    req = new URL(requestUri);
    reg = new URL(registeredUri);
  } catch {
    return false;
  }

  if (
    req.protocol === 'http:' &&
    reg.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(req.hostname) &&
    LOOPBACK_HOSTS.has(reg.hostname) &&
    req.hostname === reg.hostname &&
    req.pathname === reg.pathname &&
    req.search === reg.search &&
    req.hash === reg.hash &&
    req.username === reg.username &&
    req.password === reg.password
  ) {
    return true;
  }

  return false;
}
