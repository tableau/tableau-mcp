import { serverName } from '../../server.web.js';
import { LOOPBACK_HOSTS } from './loopbackHosts.js';

/**
 * Builds the canonical OAuth protected-resource identifier for this MCP server.
 *
 * `OAUTH_RESOURCE_URI` is the deployment domain only (no path), but the MCP server is reached at
 * `<domain>/tableau-mcp`, so the resource identifier appends the server name. This is the single
 * source of truth shared by the protected-resource metadata document (the `resource` field clients
 * read) and the access token audience check, so the advertised resource and the validated `aud`
 * cannot drift.
 *
 * Leading/trailing slashes on each segment are stripped before joining so the result can never
 * contain a doubled `/` regardless of how `resourceUri` is configured.
 *
 * @param resourceUri - The configured OAuth resource URI (`config.oauth.resourceUri`).
 * @returns The canonical resource identifier, e.g. `https://host/tableau-mcp`.
 */
export function buildResourceIdentifier(resourceUri: string): string {
  return [resourceUri, serverName].map((segment) => segment.replace(/^\/+|\/+$/g, '')).join('/');
}

/**
 * Strips trailing slashes from a URI so audience comparisons are resilient to a configured or
 * token-stamped value differing only by a trailing `/`. Per RFC 3986, `https://host` and
 * `https://host/` identify the same resource, and the MCP spec recommends the no-slash form; this
 * canonicalizes both sides of the `aud` check to that form so an otherwise-valid token is not
 * rejected over a cosmetic difference.
 *
 * @param uri - The URI to canonicalize.
 * @returns The URI with any trailing slashes removed.
 */
export function stripTrailingSlash(uri: string): string {
  return uri.replace(/\/+$/, '');
}

/**
 * Canonicalizes the loopback host of a URI so the interchangeable local-dev forms `localhost`,
 * `127.0.0.1`, and `[::1]` compare equal in the audience check. The `OAUTH_RESOURCE_URI` default
 * is `http://127.0.0.1:<port>` while a locally-run server is just as often reached at
 * `http://localhost:<port>`, so a token stamped with one loopback form must still match a resource
 * identifier configured with another. Only URIs whose host is one of those loopback forms are
 * rewritten (to `127.0.0.1`); every other value — including all remote hosts and non-URL audiences
 * — is returned unchanged, so the relaxation cannot broaden matching to any unintended host.
 * Scheme, port, and path are preserved, so e.g. `https://localhost` still will not match
 * `http://127.0.0.1`.
 *
 * @param uri - The URI to canonicalize.
 * @returns The URI with a loopback host normalized to `127.0.0.1`, or the input unchanged.
 */
export function canonicalizeLoopbackHost(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return uri;
  }

  url.hostname = '127.0.0.1';
  return url.toString();
}
