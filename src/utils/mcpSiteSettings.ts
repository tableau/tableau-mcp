import { Config, getConfig } from '../config.js';
import {
  getOverridableConfig,
  isOverridableVariable,
  OverridableConfig,
} from '../overridableConfig.js';
import { RestApiArgs, useRestApi } from '../restApiInstance.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { McpSiteSettings, McpSiteSettingsResult } from '../sdks/tableau/types/mcpSiteSettings.js';
import { ExpiringMap } from './expiringMap.js';
import { getSiteLuidFromAccessToken } from './getSiteLuidFromAccessToken.js';
import { DistributiveOmit } from './types.js';

type SiteNameOrSiteId = string;

const MCP_SITE_SETTINGS_MIN_REST_API_VERSION = '3.29';
let mcpSiteSettingsCache: ExpiringMap<SiteNameOrSiteId, McpSiteSettings>;

async function getMcpSiteSettings({
  restApiArgs,
}: {
  restApiArgs: RestApiArgs;
}): Promise<McpSiteSettings | undefined> {
  const { config, tableauAuthInfo } = restApiArgs;
  if (
    !config.enableMcpSiteSettings ||
    !RestApi.versionIsAtLeast(MCP_SITE_SETTINGS_MIN_REST_API_VERSION)
  ) {
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

  const mcpSiteSettings: McpSiteSettings = {};
  try {
    const result: McpSiteSettingsResult = await useRestApi({
      ...restApiArgs,
      jwtScopes: ['tableau:mcp_site_settings:read'],
      callback: async (restApi) =>
        await restApi.mcpSettingsMethods.getMcpSiteSettings({ siteId: restApi.siteId }),
    });
    for (const setting of result.settings) {
      if (isOverridableVariable(setting.key)) {
        mcpSiteSettings[setting.key] = setting.value;
      }
    }
  } catch {
    // getting mcpSiteSettings fails when the `MCPSettingsEnabled` feature is disabled on a site
    // we should still cache the result to avoid repeated requests
    // TODO: should we log here? there's also an internal server error if the settings are in a bad state and need to be overwritten. maybe log that one?
  }

  mcpSiteSettingsCache.set(cacheKey, mcpSiteSettings);
  return mcpSiteSettings;
}

// Make "config" and "signal" optional
type GetConfigWithOverridesArgs = DistributiveOmit<RestApiArgs, 'config' | 'signal'> &
  Partial<{ config: Config; signal: AbortSignal }>;

export async function getConfigWithOverrides({
  restApiArgs,
}: {
  restApiArgs: GetConfigWithOverridesArgs;
}): Promise<OverridableConfig> {
  const config = restApiArgs.config ?? getConfig();
  const signal = restApiArgs.signal ?? AbortSignal.timeout(config.maxRequestTimeoutMs);

  const siteOverrides = await getMcpSiteSettings({
    restApiArgs: { ...restApiArgs, config, signal },
  });

  return getOverridableConfig(siteOverrides);
}
