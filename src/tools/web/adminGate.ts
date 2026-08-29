import { Err, Ok, Result } from 'ts-results-es';

import { RestApiArgs, useRestApi } from '../../restApiInstance.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { isAdminSiteRole } from '../../sdks/tableau/types/user.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';

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
    return new Err('This tool requires administrative permissions');
  }

  const user = await restApi.usersMethods.queryUserOnSite({ siteId, userId });
  const siteRole = user.siteRole ?? '';

  if (!isAdminSiteRole(siteRole)) {
    const message = siteRole
      ? `This tool requires administrative permissions. Your site role is: ${siteRole}`
      : 'This tool requires administrative permissions';
    return new Err(message);
  }

  return new Ok(true);
}

export const MAX_SITE_ROLE_FETCH_ATTEMPTS = 3;

/**
 * Fetches the site role of the caller identified by `tableauAuthInfo`.
 *
 * Used at tool-registration time to gate tools by role — callers pair this with
 * {@link isAdminSiteRole} (or future role predicates) to decide which tools to expose.
 *
 * Retries a failing fetch up to {@link MAX_SITE_ROLE_FETCH_ATTEMPTS} times so a transient
 * network/sign-in blip during registration doesn't needlessly hide role-gated tools. Fail-closed:
 * once every attempt has thrown, returns `undefined` (as does any missing-auth case, since the
 * sign-in path throws) so a failure never grants access via a falsy role predicate. A *successful*
 * fetch with no role returns `''` — so `undefined` uniquely signals "the fetch failed", letting the
 * caller distinguish an outage from a legitimately low role. The caller is expected to fetch the
 * role once per registration pass and reuse the result across tools.
 */
export async function getCurrentUserSiteRole(
  restApiArgs: RestApiArgs,
): Promise<string | undefined> {
  for (let attempt = 1; attempt <= MAX_SITE_ROLE_FETCH_ATTEMPTS; attempt++) {
    try {
      return await useRestApi({
        ...restApiArgs,
        jwtScopes: ['tableau:users:read'],
        callback: async (restApi) => {
          const user = await restApi.usersMethods.queryUserOnSite({
            siteId: restApi.siteId,
            userId: restApi.userId,
          });
          return user.siteRole ?? '';
        },
      });
    } catch {
      // Swallow and retry; the final failure falls through to the fail-closed `undefined` below.
    }
  }
  return undefined;
}
