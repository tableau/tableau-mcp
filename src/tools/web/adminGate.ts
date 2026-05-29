import { Err, Ok, Result } from 'ts-results-es';

import { RestApi } from '../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../utils/expiringMap.js';
import { milliseconds } from '../../utils/milliseconds.js';
import { parseNumber } from '../../utils/parseNumber.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

const ADMIN_SITE_ROLES = new Set([
  'SiteAdministratorCreator',
  'SiteAdministratorExplorer',
  'ServerAdministrator',
]);

function isAdminSiteRole(siteRole: string | undefined): boolean {
  return !!siteRole && ADMIN_SITE_ROLES.has(siteRole);
}

// Lazy-initialized cache to avoid module-level parseNumber call
let cache: ExpiringMap<string, string> | null = null;

function getCache(): ExpiringMap<string, string> {
  if (!cache) {
    const ttlMinutes = parseNumber(process.env.ADMIN_GATE_CACHE_TTL_MINUTES, {
      defaultValue: 5,
      minValue: 1,
      maxValue: 60 * 24, // 24 hours
    });
    cache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(ttlMinutes),
    });
  }
  return cache;
}

/**
 * Checks if the current user has admin permissions.
 *
 * @param restApi - REST API instance
 * @param extra - Request handler extra context (for getUserLuid)
 * @returns Ok(true) if user is admin, Err(message) otherwise
 */
export async function assertAdmin(
  restApi: RestApi,
  extra: TableauWebRequestHandlerExtra,
): Promise<Result<true, string>> {
  const siteId = restApi.siteId;
  const userId = extra.getUserLuid();
  if (!userId) {
    return new Err('This tool requires site administrator permissions');
  }

  const cacheKey = `${siteId}:${userId}`;
  const adminCache = getCache();
  let siteRole = adminCache.get(cacheKey);

  if (!siteRole) {
    const user = await restApi.usersMethods.queryUserOnSite({ siteId, userId });
    siteRole = user.siteRole ?? '';
    adminCache.set(cacheKey, siteRole);
  }

  if (!isAdminSiteRole(siteRole)) {
    const message = siteRole
      ? `This tool requires site administrator permissions. Your site role is: ${siteRole}`
      : 'This tool requires site administrator permissions';
    return new Err(message);
  }

  return new Ok(true);
}
