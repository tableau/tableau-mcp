import { serverName } from '../../server.web.js';

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
