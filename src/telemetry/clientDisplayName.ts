import { parseUrl } from '../utils/parseUrl.js';

/**
 * Maps the host of a known OAuth `client_id` value to a human-readable display name for telemetry.
 *
 * OAuth `client_id` values in this server are Client ID Metadata Document (CIMD) URLs — the
 * `client_id` is itself an HTTPS URL (see `src/server/oauth/authorize.ts` and the Bearer token
 * `client_id` claim in `src/server/oauth/schemas.ts`). Per the CIMD spec, client identity is
 * anchored on the URL's host (consent screens display the host, not the self-asserted
 * `client_name`), so we key this map on host rather than on brittle exact URLs, which are not
 * stable, global constants across deployments.
 *
 * Friendly names mirror the existing precedent in `getDeviceName()`
 * (`src/server/oauth/authorize.ts`), which already labels Cursor and VS Code, plus Claude — the
 * clients named by the story. This is a static, network-free map (telemetry hot path); extend it
 * by adding host → name entries.
 */
const knownClientDisplayNamesByHost: ReadonlyMap<string, string> = new Map([
  ['claude.ai', 'Claude'],
  ['cursor.com', 'Cursor'],
  ['cursor.sh', 'Cursor'],
  ['vscode.dev', 'VS Code'],
]);

/**
 * Returns a friendly display name for a known OAuth `client_id`, or `undefined` when the client is
 * unknown or the id is missing. The raw `client_id` remains the source of truth; callers fall back
 * to it when this returns `undefined`.
 */
export function getClientDisplayName(clientId: string | undefined): string | undefined {
  if (!clientId) {
    return undefined;
  }

  const url = parseUrl(clientId);
  if (!url) {
    return undefined;
  }

  const host = url.hostname.toLowerCase();
  for (const [knownHost, displayName] of knownClientDisplayNamesByHost) {
    if (host === knownHost || host.endsWith(`.${knownHost}`)) {
      return displayName;
    }
  }

  return undefined;
}
