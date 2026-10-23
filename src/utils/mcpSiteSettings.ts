import { Config, getConfig } from '../config.js';
import { log } from '../logging/logger.js';
import {
  getOverridableConfig,
  isOverridableVariable,
  OverridableConfig,
} from '../overridableConfig.js';
import { RestApiArgs, useRestApi } from '../restApiInstance.js';
import { RestApi } from '../sdks/tableau/restApi.js';
import { McpSiteSettings, McpSiteSettingsResult } from '../sdks/tableau/types/mcpSiteSettings.js';
import { isAxiosError } from './axios.js';
import { ExpiringMap } from './expiringMap.js';
import { getExceptionMessage } from './getExceptionMessage.js';
import { getSiteLuidFromAccessToken } from './getSiteLuidFromAccessToken.js';
import { DistributiveOmit } from './types.js';

type SiteNameOrSiteId = string;

const MCP_SITE_SETTINGS_MIN_REST_API_VERSION = '3.29';
let loggedUncacheableSite = false;
const loggedFetchFailureKeys = new Set<string>();
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

  // Passthrough REST calls run on the token's own site part, so key on that; but cache only when it matches
  // the session site Tableau validated, so a forged site part cannot read or plant another site's entry.
  const siteLuid =
    tableauAuthInfo?.type === 'Passthrough'
      ? getSiteLuidFromAccessToken(tableauAuthInfo.raw)
      : getSiteLuidFromAccessToken(tableauAuthInfo);
  const site = siteLuid ? `luid:${siteLuid.toLowerCase()}` : `name:${config.siteName || 'Default'}`;
  const cacheKey = `${config.server || tableauAuthInfo?.server || ''}|${site}`;

  const cacheable =
    tableauAuthInfo?.type !== 'Passthrough' ||
    (!!siteLuid &&
      !!tableauAuthInfo.siteId &&
      siteLuid.toLowerCase() === tableauAuthInfo.siteId.toLowerCase());
  if (!cacheable && !loggedUncacheableSite) {
    loggedUncacheableSite = true;
    log({
      message:
        'MCP site settings are not cached: the token site part differs from the session site.',
      level: 'debug',
      logger: 'config',
    });
  }

  const cachedSettings = cacheable ? mcpSiteSettingsCache.get(cacheKey) : undefined;
  if (cachedSettings) {
    return cachedSettings;
  }

  const mcpSiteSettings: McpSiteSettings = {};
  let cacheResult = cacheable;
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
  } catch (error) {
    if (isAxiosError(error)) {
      if (error.response?.status === 500) {
        throw new Error(
          'Internal Server Error: The MCP settings are in a bad state and need to be overwritten.',
        );
      } else if (error.response?.status !== 403) {
        throw new Error(
          `An unexpected error occurred while getting MCP settings for site. Status code: ${error.response?.status}`,
        );
      }
      // else: (403 status code) MCP settings feature flag was disabled on this site,
      // continue and cache with empty settings.
    } else {
      cacheResult = false;
      // Uncacheable requests share one key so forged site parts cannot grow the set.
      const warnKey = cacheable ? cacheKey : 'uncacheable';
      if (!loggedFetchFailureKeys.has(warnKey)) {
        loggedFetchFailureKeys.add(warnKey);
        log({
          message: `Could not get MCP site settings; using none and retrying on the next request: ${getExceptionMessage(error)}`,
          level: 'warning',
          logger: 'config',
        });
      }
    }
  }

  if (!config.allowSitesToConfigureRequestOverrides) {
    delete mcpSiteSettings.ALLOWED_REQUEST_OVERRIDES;
  }

  if (cacheResult) {
    mcpSiteSettingsCache.set(cacheKey, mcpSiteSettings);
  }
  return mcpSiteSettings;
}

// Make "config" and "signal" optional
type GetConfigWithOverridesArgs = DistributiveOmit<RestApiArgs, 'config' | 'signal'> &
  Partial<{ config: Config; signal: AbortSignal }>;

export async function getConfigWithOverrides({
  restApiArgs,
  requestOverrides,
}: {
  restApiArgs: GetConfigWithOverridesArgs;
  requestOverrides: Record<string, string> | undefined;
}): Promise<OverridableConfig> {
  const config = restApiArgs.config ?? getConfig();
  const signal = restApiArgs.signal ?? AbortSignal.timeout(config.maxRequestTimeoutMs);

  const siteOverrides = await getMcpSiteSettings({
    restApiArgs: { ...restApiArgs, config, signal },
  });

  return getOverridableConfig(siteOverrides, requestOverrides);
}
