import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Strict scope matching is enabled only when BOTH `ENFORCE_STRICT_SCOPE_MATCH=true` AND the
 * `enforce-strict-scope-match` feature flag are set — either being false opts out (subset tokens
 * accepted). The env boolean is read first so the flag is not consulted when opted out via env.
 * This is the single source of the "both true" rule; every enforcement site calls it.
 */
export async function isStrictScopeMatchEnabled(
  config: Pick<Config, 'oauth'>,
): Promise<boolean> {
  return (
    config.oauth.strictScopeMatch &&
    (await getFeatureGate().isFeatureEnabled('enforce-strict-scope-match'))
  );
}
