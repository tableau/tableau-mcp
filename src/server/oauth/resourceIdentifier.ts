import { serverName } from '../../server.web.js';

/**
 * Builds the canonical OAuth protected-resource identifier for this MCP server.
 *
 * This is the single source of truth shared by the protected-resource metadata
 * document (the `resource` field clients read) and the access token audience
 * check. Computing both from this helper guarantees the advertised resource and
 * the validated `aud` claim match byte-for-byte regardless of how `resourceUri`
 * is configured.
 *
 * @param resourceUri - The configured OAuth resource URI (`config.oauth.resourceUri`).
 * @returns The canonical resource identifier, e.g. `https://host/tableau-mcp`.
 */
export function buildResourceIdentifier(resourceUri: string): string {
  return `${resourceUri}/${serverName}`;
}
