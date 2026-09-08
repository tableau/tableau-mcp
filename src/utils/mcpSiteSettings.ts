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
import { buildAuthenticationErrorMessage } from './authErrorMessage.js';
import { isAxiosError } from './axios.js';
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

  const cacheKey = config.siteName || getSiteLuidFromAccessToken(tableauAuthInfo) || 'Default';
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
  } catch (error) {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 500) {
        throw new Error(
          'Internal Server Error: The MCP settings are in a bad state and need to be overwritten.',
        );
      } else if (status === 401) {
        // Authentication failed while fetching site settings during launch. This historically threw
        // and took the whole server down before any tools registered, so a bad/expired PAT looked
        // like a connection failure rather than an auth failure (W-23757363). Degrade gracefully:
        // log clear auth guidance and continue with empty (default) settings so the base tools still
        // register and the server connects — matching the OAuth path, which connects and then
        // returns the same 401 guidance at tool-call time.
        const site = config.siteName || getSiteLuidFromAccessToken(tableauAuthInfo);
        log({
          message: `${buildAuthenticationErrorMessage({
            site,
            server: config.server || tableauAuthInfo?.server,
          })} Skipping MCP site settings and continuing with defaults.`,
          level: 'warning',
          logger: 'mcp-site-settings',
        });
      } else if (status !== 403) {
        throw new Error(
          `An unexpected error occurred while getting MCP settings for site. Status code: ${status}`,
        );
      }
      // else: (403 status code) MCP settings feature flag was disabled on this site,
      // continue and cache with empty settings.
    }
  }

  if (!config.allowSitesToConfigureRequestOverrides) {
    delete mcpSiteSettings.ALLOWED_REQUEST_OVERRIDES;
  }

  mcpSiteSettingsCache.set(cacheKey, mcpSiteSettings);
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
