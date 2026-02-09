import { Config, getConfig, TEN_MINUTES_IN_MS } from '../config.js';
import { getOverrideableConfig, OverrideableConfig } from '../overrideableConfig.js';
import { RestApiArgs, useRestApi } from '../restApiInstance.js';
import { getSiteIdFromAccessToken } from '../sdks/tableau/getSiteIdFromAccessToken.js';
import { McpSiteSettings } from '../sdks/tableau/types/mcpSiteSettings.js';
import { ExpiringMap } from './expiringMap.js';

type SiteNameOrSiteId = string;
const mcpSiteSettingsCache = new ExpiringMap<SiteNameOrSiteId, McpSiteSettings>({
  defaultExpirationTimeMs: TEN_MINUTES_IN_MS,
});

async function getMcpSiteSettings({
  restApiArgs,
}: {
  restApiArgs: RestApiArgs;
}): Promise<McpSiteSettings | undefined> {
  const { config, authInfo } = restApiArgs;
  if (!config.enableMcpSiteSettings) {
    return;
  }

  const cacheKey = config.siteName || getSiteIdFromAccessToken(authInfo?.accessToken ?? '');
  const cachedSettings = mcpSiteSettingsCache.get(cacheKey);
  if (cachedSettings) {
    return cachedSettings;
  }

  const settings = await useRestApi({
    ...restApiArgs,
    jwtScopes: ['tableau:mcp_site_settings:read'],
    callback: async (restApi) => await restApi.siteMethods.getMcpSettings(),
  });

  mcpSiteSettingsCache.set(cacheKey, settings);
  return settings;
}

export async function getConfigWithOverrides({
  restApiArgs,
}: {
  restApiArgs: Omit<RestApiArgs, 'config' | 'signal'> &
    Partial<{ config: Config; signal: AbortSignal }>;
}): Promise<OverrideableConfig> {
  const config = restApiArgs.config ?? getConfig();
  const signal = restApiArgs.signal ?? AbortSignal.timeout(config.maxRequestTimeoutMs);

  const overrides = await getMcpSiteSettings({
    restApiArgs: { ...restApiArgs, config, signal },
  });

  return getOverrideableConfig(overrides);
}
