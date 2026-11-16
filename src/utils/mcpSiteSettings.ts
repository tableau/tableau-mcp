import { Config, getConfig } from '../config.js';
import { McpSiteSettingsUnavailableError } from '../errors/mcpToolError.js';
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
import { getHttpStatus } from './getHttpStatus.js';
import { getSiteLuidFromAccessToken } from './getSiteLuidFromAccessToken.js';
import { DistributiveOmit } from './types.js';

type SiteNameOrSiteId = string;

const MCP_SITE_SETTINGS_MIN_REST_API_VERSION = '3.29';
let loggedUncacheableSite = false;
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
    // A 403 means the MCP settings feature is disabled on this site: continue and cache with empty settings.
    if (!isAxiosError(error) || error.response?.status !== 403) {
      log(
        {
          message: `Could not get MCP site settings: ${getExceptionMessage(error)}`,
          level: 'error',
          logger: 'config',
          data: error,
        },
        restApiArgs,
      );
      throw toSiteSettingsUnavailableError(error);
    }
  }

  if (!config.allowSitesToConfigureRequestOverrides) {
    delete mcpSiteSettings.ALLOWED_REQUEST_OVERRIDES;
  }

  if (cacheable) {
    mcpSiteSettingsCache.set(cacheKey, mcpSiteSettings);
  }
  return mcpSiteSettings;
}

// Keeps Tableau's 4xx or 5xx so a client fault is not reported as ours; a failure with no HTTP status is a 500.
function toSiteSettingsUnavailableError(error: unknown): McpSiteSettingsUnavailableError {
  const upstreamStatus = error instanceof Error ? Number(getHttpStatus(error)) : NaN;
  if (!(upstreamStatus >= 400 && upstreamStatus <= 599)) {
    return new McpSiteSettingsUnavailableError(
      'Could not get the MCP settings for this Tableau site.',
      500,
    );
  }
  const message =
    upstreamStatus === 500
      ? 'The MCP settings for this Tableau site are in a bad state and need to be overwritten.'
      : `Could not get the MCP settings for this Tableau site. Status code: ${upstreamStatus}`;
  return new McpSiteSettingsUnavailableError(message, upstreamStatus);
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
