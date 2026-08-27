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
    return new Err('This tool requires site administrator permissions');
  }

  const user = await restApi.usersMethods.queryUserOnSite({ siteId, userId });
  const siteRole = user.siteRole ?? '';

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
 * failure never grants access via a falsy role predicate. The caller is expected to
 * fetch the role once per registration pass and reuse the result across tools.
 */
export async function getCurrentUserSiteRole(
  restApiArgs: RestApiArgs,
): Promise<string | undefined> {
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
    return undefined;
  }
}
