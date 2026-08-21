import { Err, Ok, Result } from 'ts-results-es';

import { RestApiArgs, useRestApi } from '../../restApiInstance.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { isAdminSiteRole } from '../../sdks/tableau/types/user.js';
import { ExpiringMap } from '../../utils/expiringMap.js';
import { milliseconds } from '../../utils/milliseconds.js';
import { parseNumber } from '../../utils/parseNumber.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

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

async function resolveSiteRole(
  siteId: string,
  userId: string,
  fetchRole: () => Promise<string>,
): Promise<string> {
  const cacheKey = `${siteId}:${userId}`;
  const adminCache = getCache();
  const cached = adminCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const siteRole = await fetchRole();
  adminCache.set(cacheKey, siteRole);
  return siteRole;
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

  const siteRole = await resolveSiteRole(siteId, userId, async () => {
    const user = await restApi.usersMethods.queryUserOnSite({ siteId, userId });
    return user.siteRole ?? '';
  });

  if (!isAdminSiteRole(siteRole)) {
    const message = siteRole
      ? `This tool requires site administrator permissions. Your site role is: ${siteRole}`
      : 'This tool requires site administrator permissions';
    return new Err(message);
  }

  return new Ok(true);
}

/**
 * Fetches the site role of the caller identified by `tableauAuthInfo`.
 *
 * Used at tool-registration time to gate tools by role — callers pair this with
 * {@link isAdminSiteRole} (or future role predicates) to decide which tools to expose.
 * Fail-closed: returns `undefined` for any error (missing auth, network failure) so a
 * failure never grants access via a falsy role predicate. Reuses the same TTL cache as
 * {@link assertAdmin}, so a subsequent call-time check hits the cache instead of
 * re-querying.
 */
export async function getCurrentUserSiteRole(
  restApiArgs: RestApiArgs,
): Promise<string | undefined> {
  const { tableauAuthInfo } = restApiArgs;
  const siteId = tableauAuthInfo?.siteId;
  const userId = tableauAuthInfo?.userId;
  if (!siteId || !userId) {
    return undefined;
  }

  try {
    return await resolveSiteRole(siteId, userId, () =>
      useRestApi({
        ...restApiArgs,
        jwtScopes: ['tableau:users:read'],
        callback: async (restApi) => {
          const user = await restApi.usersMethods.queryUserOnSite({ siteId, userId });
          return user.siteRole ?? '';
        },
      }),
    );
  } catch {
    return undefined;
  }
}
