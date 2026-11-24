import { getFeatureGate } from './init.js';

/**
 * Whether the server advertises, grants, and honors `tableau:mcp:*`. Off keeps the explicit MCP
 * scope list everywhere, so a client only requests the wildcard once every authorization server it
 * may be pointed at can issue it.
 */
export async function isMcpWildcardScopeEnabled(): Promise<boolean> {
  return getFeatureGate().isFeatureEnabled('mcp-wildcard-scope');
}
