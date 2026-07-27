import { Config } from '../config.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';

/**
 * Derives the auth mode label for the product telemetry `tool_call` event.
 */
export function getAuthTypeForTelemetry(
  config: Config,
  tableauAuthInfo: TableauAuthInfo | undefined,
): string {
  // Per-request types populated by HTTP auth middleware — check first when present.
  if (tableauAuthInfo?.type === 'Passthrough') return 'passthrough';
  if (tableauAuthInfo?.type === 'Bearer') return 'tableau-oauth';

  // Server-level modes (pat/uat/direct-trust) and embedded oauth are identified by
  // config.auth — tableauAuthInfo is undefined for the former, 'X-Tableau-Auth' for the latter.
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
