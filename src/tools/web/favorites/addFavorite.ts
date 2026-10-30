import { Ok } from 'ts-results-es';

import { useRestApi } from '../../../restApiInstance.js';
import { favoriteLabelSchema } from '../../../sdks/tableau/types/favorite.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import {
  createFavoriteAccessChecker,
  favoriteNotAllowedError,
  favoriteTargetParamsSchema,
  getAuthenticatedFavoriteUserId,
} from './favoriteUtils.js';

const paramsSchema = {
  ...favoriteTargetParamsSchema,
  label: favoriteLabelSchema.describe(
    'Nonblank label for the favorite. Re-adding the same item with a different label replaces its favorite label.',
  ),
};

export const getAddFavoriteTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool: WebTool<typeof paramsSchema> = new WebTool({
    server,
    name: 'add-favorite',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Adds a workbook, view, datasource, or project to the authenticated user favorites. Requires access to the target content and passes all applicable bounded-context checks. An existing favorite is unchanged with the same label, or relabeled if the label differs.',
    paramsSchema,
    annotations: {
      title: 'Add Favorite',
      readOnlyHint: false,
      destructiveHint: false,
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
            jwtScopes: ['tableau:favorites:update'],
            callback: async (restApi) => {
              const userId = await getAuthenticatedFavoriteUserId(restApi);
              if (userId.isErr()) return userId;
              await restApi.favoritesMethods.addFavorite({
                siteId: restApi.siteId,
                userId: userId.value,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                label: args.label,
              });
              return new Ok({
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                label: args.label,
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
