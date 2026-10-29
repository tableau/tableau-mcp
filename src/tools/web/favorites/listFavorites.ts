import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { PageExceedsLimitError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Favorite } from '../../../sdks/tableau/types/favorite.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getPageExceedsLimitMessage, MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { WebTool } from '../tool.js';
import { createFavoriteAccessChecker, getAuthenticatedFavoriteUserId } from './favoriteUtils.js';

const paramsSchema = {
  pageNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'The 1-based favorites page to fetch, default 1. Each server page has up to 1000 entries.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(
      'Maximum allowed favorites to return from this page, at most 1000. Filtering may make a page shorter.',
    ),
};

type ListFavoritesResult = {
  favorites: Favorite[];
  pageNumber: number;
  nextPageNumber?: number;
  hasMore: boolean | null;
  note: string;
};

export const getListFavoritesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool: WebTool<typeof paramsSchema> = new WebTool({
    server,
    name: 'list-favorites',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Lists only the authenticated user favorites. Returns one server page of supported workbook, view, datasource, and project favorites after bounded-context checks. Unsupported types, deleted content, and entries that cannot be verified are omitted. A nextPageNumber indicates another server page may exist; an empty filtered page can still have a next page.',
    paramsSchema,
    annotations: {
      title: 'List Favorites',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ pageNumber = 1, limit }, extra) =>
      tool.logAndExecute<ListFavoritesResult>({
        extra,
        args: { pageNumber, limit },
        callback: async () => {
          const config = await extra.getConfigWithOverrides();
          const maxResultLimit = config.getMaxResultLimit(tool.name);
          const pageError = getPageExceedsLimitMessage({ pageNumber, maxResultLimit });
          if (pageError) return new PageExceedsLimitError(pageError).toErr();
          return new Ok(
            await useRestApi({
              ...extra,
              disableLogging: true,
              jwtScopes: ['tableau:content:read'],
              callback: async (restApi) => {
                const userId = await getAuthenticatedFavoriteUserId(restApi);
                const page = await restApi.favoritesMethods.queryFavorites({
                  siteId: restApi.siteId,
                  userId,
                  pageSize: MAX_PAGE_SIZE,
                  pageNumber,
                });
                const isAllowed = createFavoriteAccessChecker(extra);
                const favorites: Favorite[] = [];
                const offset = (pageNumber - 1) * MAX_PAGE_SIZE;
                const cap = Math.min(
                  limit ?? MAX_PAGE_SIZE,
                  maxResultLimit == null ? MAX_PAGE_SIZE : Math.max(0, maxResultLimit - offset),
                );
                for (const favorite of page.favorites) {
                  if (favorites.length >= cap) break;
                  if (await isAllowed(favorite)) {
                    favorites.push({
                      resourceType: favorite.resourceType,
                      resourceId: favorite.resourceId,
                      ...(favorite.label !== undefined && { label: favorite.label }),
                    });
                  }
                }
                const pagination = page.pagination;
                const metadataMatchesRequest =
                  pagination?.pageNumber === pageNumber &&
                  pagination.pageSize === MAX_PAGE_SIZE &&
                  pagination.totalAvailable >= offset + page.rawCount;
                const hasMore = metadataMatchesRequest
                  ? pageNumber * MAX_PAGE_SIZE < pagination.totalAvailable
                  : null;
                const nextReachable =
                  maxResultLimit == null || pageNumber * MAX_PAGE_SIZE < maxResultLimit;
                return {
                  favorites,
                  pageNumber,
                  hasMore,
                  ...(hasMore !== false && nextReachable && { nextPageNumber: pageNumber + 1 }),
                  note: 'Unsupported, deleted, and unverifiable favorites are omitted. Counts and metadata for omitted entries are not returned. hasMore is null when Tableau omits pagination; even a short or empty page does not establish completeness. limit trims this page; use a larger limit to retrieve additional matches from the same page.',
                };
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
