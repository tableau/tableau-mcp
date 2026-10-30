import { Ok } from 'ts-results-es';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import {
  createFavoriteAccessChecker,
  favoriteNotAllowedError,
  favoriteTargetParamsSchema,
  getAuthenticatedFavoriteUserId,
} from './favoriteUtils.js';

export const getRemoveFavoriteTool = (
  server: WebMcpServer,
): WebTool<typeof favoriteTargetParamsSchema> => {
  const tool: WebTool<typeof favoriteTargetParamsSchema> = new WebTool({
    server,
    name: 'remove-favorite',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Removes a workbook, view, datasource, or project from the authenticated user favorites shortlist only. The Tableau content itself is never deleted. Requires target access and all applicable bounded-context checks. Removing an absent favorite has no effect, although some Tableau versions return a not-found error.',
    paramsSchema: favoriteTargetParamsSchema,
    annotations: {
      title: 'Remove Favorite',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async (args, extra) =>
      tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          // Complete permission probes before opening the mutation session: signing in again
          // with the same Cloud PAT invalidates its preceding session.
          const allowed = await createFavoriteAccessChecker(extra)(args);
          if (allowed.isErr()) return allowed;
          if (!allowed.value) return favoriteNotAllowedError().toErr();
          return useRestApi({
            ...extra,
            disableLogging: true,
            jwtScopes: ['tableau:favorites:delete'],
            callback: async (restApi) => {
              const userId = await getAuthenticatedFavoriteUserId(restApi);
              if (userId.isErr()) return userId;
              await restApi.favoritesMethods.removeFavorite({
                siteId: restApi.siteId,
                userId: userId.value,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
              });
              return new Ok({
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                removedFromFavorites: true,
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
