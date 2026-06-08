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
