/**
 * Shared, self-explanatory guidance for Tableau MCP authentication (401) and permission (403)
 * failures.
 *
 * Centralizing the wording here keeps the message identical across every auth mode — PAT, OAuth,
 * direct-trust / connected-app, UAT, and passthrough — and across every surface that can emit an
 * auth failure:
 *   - the tool-execution error wrapper (src/tools/web/tool.ts),
 *   - the startup site-settings fetch (src/utils/mcpSiteSettings.ts), and
 *   - the OAuth transport challenge (src/server/oauth/authMiddleware.ts).
 *
 * W-23757363: a bare "Request failed with status code 401" (or a server that failed to start while
 * fetching site settings) was being paraphrased by the model into a misleading "feature not
 * configured" message. Naming the cause — and, where known, the targeted site + pod — makes a 401
 * impossible to misread as "Admin Insights is missing."
 */

type AuthTarget = { site?: string; server?: string };

/**
 * Renders the ` (site "X", pod "Y")` clause, omitting whichever part could not be determined.
 * Returns an empty string when neither is known (e.g. before sign-in), so the sentence still reads.
 */
export function describeAuthTarget({ site, server }: AuthTarget): string {
  const parts: string[] = [];
  if (site) {
    parts.push(`site "${site}"`);
  }
  if (server) {
    parts.push(`pod "${server}"`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/** Clear guidance for a downstream Tableau REST 401 (missing / invalid / expired credentials). */
export function buildAuthenticationErrorMessage(target: AuthTarget = {}): string {
  return (
    'Authentication failed (401): the credentials for this Tableau MCP server' +
    `${describeAuthTarget(target)} are missing, invalid, or expired. ` +
    'If multiple Tableau MCP servers are configured, verify the request targeted the intended ' +
    'server, then re-authenticate (renew the personal access token or re-run the OAuth sign-in). ' +
    'A 401 is an authentication problem, not a missing feature.'
  );
}

/** Clear guidance for a downstream Tableau REST 403 (authenticated, but the request was refused). */
export function buildPermissionErrorMessage(target: AuthTarget = {}): string {
  return (
    'Permission denied (403): you are authenticated to this Tableau MCP server' +
    `${describeAuthTarget(target)} but this request was refused. Your account may lack the ` +
    'required site role or permission, or the capability may not be enabled for this site. This ' +
    'is not an authentication failure — do not re-authenticate. Use an account with the required ' +
    'permissions, or confirm the capability is enabled for this site.'
  );
}

/**
 * Guidance appended to the OAuth transport challenge (a 401 returned before any tool runs, where
 * the targeted site / pod are not yet known). Kept alongside — never in place of — the
 * `WWW-Authenticate` challenge so the re-authentication flow still works.
 */
export const OAUTH_AUTH_CHALLENGE_GUIDANCE =
  'If multiple Tableau MCP servers are configured, this 401 means the request reached a server ' +
  'whose session is missing, invalid, or expired — verify you targeted the intended server and ' +
  're-authenticate. A 401 is an authentication problem, not a missing feature.';
