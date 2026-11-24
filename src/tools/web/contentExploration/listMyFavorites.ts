import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { LUID_PATTERN } from '../../../sdks/routeSafety/core.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  Favorite,
  FavoriteReference,
  favoriteTypes,
} from '../../../sdks/tableau/types/favorite.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

const paramsSchema = {
  pageNumber: z.number().int().positive().optional().describe('Native page number, starting at 1.'),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe('Favorites per native page, default 100. Keep this value constant while paging.'),
};

function allowedReferences(favorite: Favorite, bounds: BoundedContext): FavoriteReference[] {
  const references: FavoriteReference[] = [];
  for (const type of favoriteTypes) {
    const item = favorite[type];
    if (!item) continue;
    const projectId = type === 'project' ? item.id : item.project?.id;
    if (bounds.projectIds && (!projectId || !bounds.projectIds.has(projectId))) continue;
    if (bounds.tags && !item.tags?.tag?.some((tag) => bounds.tags?.has(tag.label))) continue;
    if (type === 'datasource' && bounds.datasourceIds && !bounds.datasourceIds.has(item.id))
      continue;
    if (type === 'view' && bounds.viewIds && !bounds.viewIds.has(item.id)) continue;
    if ((type === 'workbook' || type === 'view') && bounds.workbookIds) {
      const workbookId = type === 'workbook' ? item.id : item.workbook?.id;
      if (!workbookId || !bounds.workbookIds.has(workbookId)) continue;
    }
    references.push({ type, luid: item.id });
  }
  return references;
}

type FavoritesPrincipal = { site_luid: string; user_luid: string };
type FavoritesPage = {
  principal: FavoritesPrincipal;
  data: FavoriteReference[];
  nextPageNumber: number | null;
};

async function verifyPrincipal(
  restApi: RestApi,
  extra: TableauWebRequestHandlerExtra,
): Promise<FavoritesPrincipal> {
  const session = await restApi.authenticatedServerMethods.getCurrentServerSession();
  if (session.isErr()) {
    throw new Error('Could not verify the current Tableau session. Sign in again and retry.');
  }

  const { site, user } = session.value;
  if (!LUID_PATTERN.test(site.id) || !LUID_PATTERN.test(user.id)) {
    throw new Error(
      'The Tableau session did not identify a valid site and user. Sign in again and retry.',
    );
  }

  const caller = extra.tableauAuthInfo;
  if (
    extra.config.transport === 'http' &&
    (caller?.userId !== user.id || caller.siteId !== site.id)
  ) {
    throw new Error(
      'Authenticate with your own Tableau user and site to read your favorites over HTTP.',
    );
  }
  return { site_luid: site.id, user_luid: user.id };
}

export function getListMyFavoritesTool(server: WebMcpServer): WebTool<typeof paramsSchema> {
  const tool = new WebTool({
    server,
    name: 'list-my-favorites',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Lists favorited content references and the verified Tableau principal (site_luid and user_luid) for the current session. Match type and luid against accessible content to personalize ranking. Follow nextPageNumber with the same pageSize, including after an empty filtered page, until it is null.',
    paramsSchema,
    annotations: {
      title: 'List My Favorites',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ pageNumber = 1, pageSize = 100 }, extra): Promise<CallToolResult> =>
      tool.logAndExecute<FavoritesPage>({
        extra,
        args: { pageNumber, pageSize },
        callback: async () => {
          const config = await extra.getConfigWithOverrides();
          const cap = config.getMaxResultLimit(tool.name);
          const offset = (pageNumber - 1) * pageSize;

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: async (restApi) => {
                const principal = await verifyPrincipal(restApi, extra);
                if (cap !== null && offset >= cap) {
                  return { principal, data: [], nextPageNumber: null };
                }
                const { favorites, pagination } = await restApi.usersMethods.listFavoritesForUser({
                  siteId: principal.site_luid,
                  userId: principal.user_luid,
                  pageNumber,
                  pageSize,
                });
                const rows = favorites.favorite ?? [];
                const pageEnd = offset + pageSize;
                const hasMore = pagination ? pageEnd < pagination.totalAvailable : rows.length > 0;
                const data = rows
                  .slice(0, cap === null ? pageSize : Math.min(pageSize, cap - offset))
                  .flatMap((favorite) => allowedReferences(favorite, config.boundedContext));
                return {
                  principal,
                  data,
                  nextPageNumber:
                    hasMore && (cap === null || pageEnd < cap) ? pageNumber + 1 : null,
                };
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
}
