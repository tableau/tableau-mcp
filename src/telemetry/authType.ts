import { Config } from '../config.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';

/**
 * Derives the auth mode label for the product telemetry `tool_call` event.
 *
 * `TableauAuthInfo.type` disambiguates Bearer/Passthrough directly, but 'X-Tableau-Auth' is shared
 * by pat/uat/direct-trust/embedded-oauth, so those split on the server's configured `config.auth`.
 */
export function getAuthTypeForTelemetry(
  config: Config,
  tableauAuthInfo: TableauAuthInfo | undefined,
): string {
  if (!tableauAuthInfo) return 'unknown';
  if (tableauAuthInfo.type === 'Passthrough') return 'passthrough';
  if (tableauAuthInfo.type === 'Bearer') return 'tableau-oauth'; // external Tableau authz server
  switch (config.auth) {
    case 'pat':
      return 'pat';
    case 'uat':
      return 'uat';
    case 'direct-trust':
      return 'direct-trust';
    case 'oauth':
      return 'embedded-oauth';
    default:
      return 'unknown';
  }
}
