import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Strict scope matching is on unless `DISABLE_STRICT_SCOPE_MATCH=true` or the
 * `disable-strict-scope-match` feature flag is on; both default to off, so either one alone turns
 * subset matching on. The env boolean is read first so the flag is not consulted when env has
 * already turned strict off. This is the single source of the rule; every enforcement site calls it.
 */
export async function isStrictScopeMatchEnabled(config: Pick<Config, 'oauth'>): Promise<boolean> {
  return (
    !config.oauth.disableStrictScopeMatch &&
    !(await getFeatureGate().isFeatureEnabled('disable-strict-scope-match'))
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
