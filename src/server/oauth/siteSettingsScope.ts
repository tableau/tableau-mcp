import { Config } from '../../config.js';

/**
 * Every grant needs the site-settings read scope when MCP site settings are enabled and API
 * scopes are enforced and advertised. Otherwise clients were never offered this scope, and
 * Tableau does not check it on the embedded server's session tokens.
 */
export function isSiteSettingsScopeRequired(
  config: Pick<Config, 'oauth' | 'enableMcpSiteSettings'>,
): boolean {
  const { enforceScopes, advertiseApiScopes } = config.oauth;
  return enforceScopes && advertiseApiScopes && config.enableMcpSiteSettings;
}
