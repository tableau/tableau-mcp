import { getOverridableConfig, OverridableConfig } from '../overridableConfig.js';
import { useRestApi } from '../restApiInstance.js';
import { McpSiteSettings } from '../sdks/tableau/types/mcpSiteSettings.js';
import { TableauRequestHandlerExtra } from '../tools/toolContext.js';
import { ExpiringMap } from './expiringMap.js';
import { getSiteLuidFromAccessToken } from './getSiteLuidFromAccessToken.js';

type SiteNameOrSiteId = string;
let mcpSiteSettingsCache: ExpiringMap<SiteNameOrSiteId, McpSiteSettings>;

async function getMcpSiteSettings(
  extra: TableauRequestHandlerExtra,
): Promise<McpSiteSettings | undefined> {
  const { config, tableauAuthInfo } = extra;
  if (!config.enableMcpSiteSettings) {
    return;
  }

  if (!mcpSiteSettingsCache) {
    mcpSiteSettingsCache = new ExpiringMap<SiteNameOrSiteId, McpSiteSettings>({
      defaultExpirationTimeMs: config.mcpSiteSettingsCheckIntervalInMinutes * 60 * 1000,
    });
  }

  const cacheKey = config.siteName || getSiteLuidFromAccessToken(tableauAuthInfo);
  if (!cacheKey) {
    throw new Error('Could not determine site ID/name');
  }

  const cachedSettings = mcpSiteSettingsCache.get(cacheKey);
  if (cachedSettings) {
    return cachedSettings;
  }

  const settings = await useRestApi(
    {
      ...extra,
      jwtScopes: ['tableau:mcp_site_settings:read'],
      callback: async (restApi) => await restApi.siteMethods.getMcpSettings(),
    },
    extra,
  );

  mcpSiteSettingsCache.set(cacheKey, settings);
  return settings;
}

export async function getConfigWithOverrides(
  extra: TableauRequestHandlerExtra,
): Promise<OverridableConfig> {
  const overrides = await getMcpSiteSettings(extra);
  return getOverridableConfig(overrides);
}
