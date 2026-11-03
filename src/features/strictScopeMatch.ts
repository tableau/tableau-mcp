import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Strict scope matching is enabled when EITHER `ENFORCE_STRICT_SCOPE_MATCH=true` OR the
 * `enforce-strict-scope-match` feature flag is set; both default to false (subset tokens accepted).
 * The env boolean is read first so the flag is not consulted when strict is already on via env.
 * This is the single source of the "either true" rule; every enforcement site calls it.
 */
export async function isStrictScopeMatchEnabled(config: Pick<Config, 'oauth'>): Promise<boolean> {
  return (
    config.oauth.strictScopeMatch ||
    (await getFeatureGate().isFeatureEnabled('enforce-strict-scope-match'))
  );
}

/**
 * Whether every grant must carry `tableau:mcp_site_settings:read`: subset (non-strict) matching with
 * site settings on. Strict mode needs no separate rule, since its full set already holds the scope.
 * Only when API scopes are advertised: otherwise clients were never offered the scope and existing
 * tokens lack it, and Tableau never checks it on the embedded server's session tokens.
 */
export async function isSiteSettingsScopeRequired(
  config: Pick<Config, 'oauth' | 'enableMcpSiteSettings'>,
): Promise<boolean> {
  const { enforceScopes, advertiseApiScopes } = config.oauth;
  return (
    enforceScopes &&
    advertiseApiScopes &&
    config.enableMcpSiteSettings &&
    !(await isStrictScopeMatchEnabled(config))
  );
}
