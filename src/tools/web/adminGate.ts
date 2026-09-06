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
 * Wraps a failed `GET /sessions/current` lookup so the shared {@link retry} helper can decide
 * whether to retry: an `unauthorized` session is a deterministic bad/expired credential (don't
 * retry), while any other failure is treated as transient.
 */
class CurrentSessionFetchError extends Error {
  constructor(readonly reason: { type: 'unauthorized' | 'unknown'; message: unknown }) {
    super(
      typeof reason.message === 'string'
        ? reason.message
        : 'Failed to fetch the current Tableau session',
    );
    this.name = 'CurrentSessionFetchError';
  }
}

/**
 * Fetches the site role of the caller identified by `tableauAuthInfo`.
 *
 * Used at tool-registration time to gate tools by role.
 *
 * Resolves the role from the authenticated session itself (`GET /sessions/current`) rather than
 * from `GET /sites/:siteId/users/:userId`. `/sessions/current` needs neither a userId nor the
 * `tableau:users:read` scope, so it works uniformly across every auth type: pat/uat/direct-trust
 * (sign-in), passthrough/embedded (X-Tableau-Auth), and OAuth Bearer — including Bearer tokens
 * that omit the `https://tableau.com/userId` claim (users without MFA), where `restApi.userId`
 * would otherwise be empty and produce a malformed `/users/` request.
 *
 * Retries a failing fetch (up to {@link MAX_SITE_ROLE_FETCH_ATTEMPTS} total attempts) via the shared
 * {@link retry} helper. A deterministic failure is *not* retried: an `unauthorized` session, or a
 * 4xx thrown by the sign-in step on the pat/uat/direct-trust path (e.g. 401/403), can't be changed
 * by retrying, so we fail fast rather than delaying registration for every unauthorized caller.
 *
 * Fail-closed: once retries are exhausted (or a non-retryable error is thrown), returns `undefined`
 * (as does any missing-auth case, since the sign-in path throws) so a failure never grants access
 * via a falsy role predicate.
 */
export async function getCurrentUserSiteRole(
  restApiArgs: RestApiArgs,
): Promise<string | undefined> {
  try {
    return await retry(
      async () =>
        await useRestApi({
          ...restApiArgs,
          // `/sessions/current` requires no scopes; this scope is retained only so the Connected App
          // sign-in used by the pat/uat/direct-trust paths keeps a valid, non-empty scope set. It is
          // ignored on the OAuth path, where the pre-issued bearer token is passed through as-is.
          jwtScopes: ['tableau:users:read'],
          callback: async (restApi) => {
            const sessionResult =
              await restApi.authenticatedServerMethods.getCurrentServerSession();
            if (sessionResult.isErr()) {
              // Rethrow so retry()/the fail-closed catch engage; retryIf inspects the failure type.
              throw new CurrentSessionFetchError(sessionResult.error);
            }
            return sessionResult.value.user.siteRole;
          },
        }),
      {
        maxRetries: MAX_SITE_ROLE_FETCH_ATTEMPTS - 1,
        retryIf: (error) => {
          // A deterministic auth failure (bad/expired credential) won't change on retry.
          if (error instanceof CurrentSessionFetchError) {
            return error.reason.type !== 'unauthorized';
          }
          // Sign-in on the pat/uat/direct-trust path can still throw an axios error directly; a 4xx
          // there (e.g. 401/403/404) is likewise deterministic, so don't retry it.
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
