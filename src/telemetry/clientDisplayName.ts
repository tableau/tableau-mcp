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
 * Upper bound on the length of a `client_id` value emitted to telemetry.
 *
 * The Bearer token `client_id` claim (`tableauBearerTokenSchema` in
 * `src/server/oauth/schemas.ts`) is only validated as a non-empty string, so it is
 * attacker-influenceable and unbounded. `accessTokenValidator` establishes the precedent of
 * capping attacker-controlled claims before logging (`MAX_LOGGED_CLAIM_LENGTH = 256`, with a
 * `... (truncated)` marker). Telemetry uses a tighter 200-char cap and, unlike the log path, does
 * NOT inject a truncation marker: the emitted value is a bounded, best-effort observability signal,
 * not a re-parsed identifier, so appending text would only add noise.
 */
const MAX_TELEMETRY_CLIENT_ID_LENGTH = 200;

/**
 * Bounds an OAuth `client_id` for emission to telemetry. The canonical, unmodified `client_id`
 * always remains in the token/auth layer (the Bearer token claim and `authInfo.clientId`); this
 * value is telemetry-only, so it is deliberately lossy:
 *
 * - URL-parseable values are reduced to `origin` + `pathname`, dropping `search`, `hash`, and any
 *   `username`/`password` userinfo — attacker-influenceable, high-cardinality, or credential-like
 *   segments that have no place in aggregate telemetry.
 * - All values (URL or not) are capped at {@link MAX_TELEMETRY_CLIENT_ID_LENGTH} with a plain
 *   slice (no ellipsis injection).
 *
 * Returns an empty string for a missing/empty id so telemetry fields stay present-but-blank.
 */
export function sanitizeClientIdForTelemetry(clientId: string | undefined): string {
  if (!clientId) {
    return '';
  }

  const url = parseUrl(clientId);
  const canonical = url ? `${url.origin}${url.pathname}` : clientId;
  return canonical.slice(0, MAX_TELEMETRY_CLIENT_ID_LENGTH);
}

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
