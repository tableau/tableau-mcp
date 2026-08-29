import { isAxiosError } from 'axios';
import { Err, Ok, Result } from 'ts-results-es';

import { RestApiArgs, useRestApi } from '../../restApiInstance.js';
import { RestApi } from '../../sdks/tableau/restApi.js';
import { isAdminSiteRole } from '../../sdks/tableau/types/user.js';
import { retry } from '../../utils/retry.js';
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

/** Total number of site-role fetch attempts (1 initial + {@link MAX_SITE_ROLE_FETCH_ATTEMPTS}-1 retries). */
export const MAX_SITE_ROLE_FETCH_ATTEMPTS = 3;

/**
 * Fetches the site role of the caller identified by `tableauAuthInfo`.
 *
 * Used at tool-registration time to gate tools by role — callers pair this with
 * {@link isAdminSiteRole} (or future role predicates) to decide which tools to expose.
 *
 * Retries a failing fetch (up to {@link MAX_SITE_ROLE_FETCH_ATTEMPTS} total attempts) via the shared
 * {@link retry} helper, which waits with exponential backoff + jitter between attempts so a transient
 * network/sign-in blip during registration doesn't needlessly hide role-gated tools — an immediate
 * retry rarely outlasts the blip it's meant to survive. A 4xx client error (e.g. 401/403) is *not*
 * retried: it's a deterministic "not allowed" that retrying cannot change, so we fail fast rather
 * than delaying registration for every genuinely-unauthorized caller.
 *
 * Fail-closed: once retries are exhausted (or a non-retryable error is thrown), returns `undefined`
 * (as does any missing-auth case, since the sign-in path throws) so a failure never grants access
 * via a falsy role predicate. A *successful* fetch with no role returns `''` — so `undefined`
 * uniquely signals "the fetch failed", letting the caller distinguish an outage from a legitimately
 * low role. The caller is expected to fetch the role once per registration pass and reuse it.
 */
export async function getCurrentUserSiteRole(
  restApiArgs: RestApiArgs,
): Promise<string | undefined> {
  try {
    return await retry(
      () =>
        useRestApi({
          ...restApiArgs,
          jwtScopes: ['tableau:users:read'],
          callback: async (restApi) => {
            const user = await restApi.usersMethods.queryUserOnSite({
              siteId: restApi.siteId,
              userId: restApi.userId,
            });
            return user.siteRole ?? '';
          },
        }),
      {
        maxRetries: MAX_SITE_ROLE_FETCH_ATTEMPTS - 1,
        retryIf: (error) => {
          // Don't retry deterministic client errors (401/403/404, …); retrying can't change them.
          if (isAxiosError(error)) {
            const status = error.response?.status;
            if (status !== undefined && status >= 400 && status < 500) {
              return false;
            }
          }
          return true;
        },
      },
    );
  } catch {
    // Retries exhausted or a non-retryable error was thrown — fail closed.
    return undefined;
  }
}
