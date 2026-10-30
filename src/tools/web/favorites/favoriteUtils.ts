import { ZodiosError } from '@zodios/core';
import { isZodErrorLike } from 'zod-validation-error/v3';

import {
  ArgsValidationError,
  McpToolError,
  ProjectNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { Favorite, favoriteResourceTypeSchema } from '../../../sdks/tableau/types/favorite.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { assertProjectAllowedByBoundedContext } from '../utils/boundedContextUtils.js';

export const favoriteTargetParamsSchema = {
  resourceType: favoriteResourceTypeSchema
    .exclude(['flow'])
    .describe(
      'The favorite content type: workbook, view, datasource, or project. Flow favorites are deferred.',
    ),
  resourceId: luidSchema.describe(
    'The Tableau LUID of the content item. Favorites removal never deletes this content.',
  ),
};

/** Local anti-amplification bounds for per-item access checks and project visibility scans. */
export const FAVORITES_PAGE_SIZE = 100;
export const MAX_FAVORITE_PROJECT_SCAN_PAGES = 10;

/** Derive self identity only from trusted authenticated REST/session state, never tool input. */
export async function getAuthenticatedFavoriteUserId(restApi: RestApi): Promise<string> {
  const userId = restApi.userId;
  if (userId) {
    if (!luidSchema.safeParse(userId).success) {
      throw new ArgsValidationError('The authenticated Tableau user ID is unavailable or invalid.');
    }
    return userId;
  }
  const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
  if (
    session.isErr() ||
    session.value.site.id !== restApi.siteId ||
    !luidSchema.safeParse(session.value.user.id).success
  ) {
    throw new ArgsValidationError(
      'Could not resolve the authenticated Tableau user on this site. Favorites require a verified user ID.',
    );
  }
  return session.value.user.id;
}

/** Existing resource gates are reused; projects additionally need a visible project lookup. */
export function createFavoriteAccessChecker(extra: TableauWebRequestHandlerExtra) {
  // ResourceAccessChecker forwards its extra context to useRestApi. Carry the existing
  // disableLogging option through that path so raw rejected metadata cannot be delivered in
  // debug REST notifications before the bounded-context result is known. Tool audit logging
  // remains active through WebTool.logAndExecute, and secret masking is unchanged.
  const configSnapshot = extra.getConfigWithOverrides();
  const quietExtra: TableauWebRequestHandlerExtra & { disableLogging: true } = {
    ...extra,
    disableLogging: true,
    getConfigWithOverrides: async () => await configSnapshot,
  };
  let visibleProjectIds: Promise<Set<string>> | undefined;
  return async ({
    resourceType,
    resourceId,
  }: Pick<Favorite, 'resourceType' | 'resourceId'>): Promise<boolean> => {
    switch (resourceType) {
      case 'workbook':
        return (
          await resourceAccessChecker.isWorkbookAllowed({
            workbookId: resourceId,
            extra: quietExtra,
          })
        ).allowed;
      case 'view':
        return (
          await resourceAccessChecker.isViewAllowed({ viewId: resourceId, extra: quietExtra })
        ).allowed;
      case 'datasource':
        return (
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: resourceId,
            extra: quietExtra,
          })
        ).allowed;
      case 'flow':
        // A mixed tool cannot use the established static OAuth map to enforce a flow-only
        // read scope without expanding the scope surface when flow tools are disabled.
        // Keep this fail-closed until argument-aware authorization is separately designed.
        return false;
      case 'project': {
        const { boundedContext } = await configSnapshot;
        // Project favorites cannot be matched to INCLUDE_TAGS. Fail closed, even when the
        // project ID itself is allowed; no project label should bypass a configured tag gate.
        if (boundedContext.tags) return false;
        try {
          assertProjectAllowedByBoundedContext(resourceId, boundedContext);
        } catch (error) {
          if (error instanceof ProjectNotAllowedError) return false;
          throw error;
        }
        visibleProjectIds ??= useRestApi({
          ...quietExtra,
          jwtScopes: ['tableau:content:read'],
          callback: async (restApi) =>
            (async () => {
              const visible = new Set<string>();
              for (
                let pageNumber = 1;
                pageNumber <= MAX_FAVORITE_PROJECT_SCAN_PAGES;
                pageNumber++
              ) {
                try {
                  const { pagination, projects } = await restApi.projectsMethods.queryProjects({
                    siteId: restApi.siteId,
                    filter: '',
                    pageSize: FAVORITES_PAGE_SIZE,
                    pageNumber,
                  });
                  projects.forEach((project) => visible.add(project.id));
                  const metadataMatches =
                    pagination.pageNumber === pageNumber &&
                    pagination.pageSize === FAVORITES_PAGE_SIZE;
                  if (
                    !metadataMatches ||
                    projects.length < FAVORITES_PAGE_SIZE ||
                    pageNumber * FAVORITES_PAGE_SIZE >= pagination.totalAvailable
                  ) {
                    break;
                  }
                } catch (error) {
                  // The existing SDK schema error can embed an entire project page. Do not
                  // expose unrelated project labels while checking a favorite's visibility.
                  if (error instanceof ZodiosError && isZodErrorLike(error.cause)) {
                    throw new Error('The project visibility response could not be validated.');
                  }
                  throw error;
                }
              }
              return visible;
            })(),
        });
        return (await visibleProjectIds).has(resourceId);
      }
    }
  };
}

export function favoriteNotAllowedError(): McpToolError {
  return new McpToolError({
    type: 'favorite-not-allowed',
    message:
      'This favorite content item is not accessible within the server bounded context. Project favorites are unavailable when a tag restriction is configured.',
    statusCode: 403,
  });
}
