import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { PageExceedsLimitError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  getViewLineageByLuid,
  getViewLineageQuery,
  mergeViewLineage,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { WebMcpServer } from '../../../server.web.js';
import { isAxiosError } from '../../../utils/axios.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
  getPage,
  getPageExceedsLimitMessage,
  GetPageResult,
  MAX_PAGE_SIZE,
} from '../../../utils/paginate.js';
import {
  contentTagSearchDescription,
  contentTagSearchLabelsSchema,
  withContentTagFilter,
} from '../_lib/contentTagFilter.js';
import { withContentTagResponseValidation } from '../_lib/contentTagResponse.js';
import { TruncationReason } from '../_lib/truncation.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateViewsFilterString } from './viewsFilterUtils.js';

const paramsSchema = {
  tagLabels: contentTagSearchLabelsSchema
    .optional()
    .describe(
      'Exact decoded tags to search for. One label matches that tag; multiple labels match ANY (OR). Cannot be combined with a tags clause in filter.',
    ),
  filter: z.string().optional(),
  pageNumber: z
    .number()
    .int()
    .gt(0)
    .optional()
    .describe('Which 1000-item page to fetch (1-based, default 1).'),
  limit: z
    .number()
    .int()
    .gt(0)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(
      'The maximum number of views to return from the requested page (must be <= 1000). Use this to fetch fewer than a full page, e.g. the final partial page a client wants, or `limit: 1` when you only need `totalAvailable` and want to minimize the response payload.',
    ),
};

type ListViewsResult = GetPageResult<View> & {
  mcp?: {
    resultInfo: { returnedCount: number; truncated: true; truncationReason: TruncationReason };
  };
};

export const getListViewsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listViewsTool = new WebTool({
    server,
    name: 'list-views',
    minRequiredRole: SiteRole.VIEWER,
    description: `
  Retrieves a list of views on a Tableau site including their metadata such as name, owner, and the workbook they are found in. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Overview) for precise and flexible view discovery.
  To list results based on usage popularity or relevance, use the search-content tool instead.

  **Supported Filter Fields and Operators**
  | Field               | Operators            |
  |---------------------|----------------------|
  | caption             | eq, in               |
  | contentUrl          | eq, in               |
  | createdAt           | eq, gt, gte, lt, lte |
  | favoritesTotal      | eq, gt, gte, lt, lte |
  | fields              | eq, in               |
  | hitsTotal           | eq, gt, gte, lt, lte |
  | name                | eq, in               |
  | ownerDomain         | eq, in               |
  | ownerEmail          | eq, in               |
  | ownerName           | eq, in               |
  | projectName         | eq, in               |
  | sheetNumber         | eq, gt, gte, lt, lte |
  | sheetType           | eq, in               |
  | tags                | eq, in               |
  | title               | eq, in               |
  | updatedAt           | eq, gt, gte, lt, lte |
  | viewUrlname         | eq, in               |
  | workbookDescription | eq, in               |
  | workbookName        | eq, in               |

  ${genericFilterDescription}

  **Tag-only discovery**
  ${contentTagSearchDescription}

  **Example Usage:**
  - List views with the name "Overview":
      filter: "name:eq:Overview"
  - List views in the "Finance" project:
      filter: "projectName:eq:Finance"
  - List views created after January 1, 2023:
      filter: "createdAt:gt:2023-01-01T00:00:00Z"
  - List views with the name "Overview" in the "Finance" project and created after January 1, 2023:
      filter: "name:eq:Overview,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"

  **Pagination**
  This tool returns a single 1000-item page per call. Use \`pageNumber\` to select which 1000-item page to fetch (1-based, default 1).
  The response is a flat object \`{ data, totalAvailable }\`; paginate by incrementing \`pageNumber\` until you have collected \`totalAvailable\` items.
  To count, call once with \`limit: 1\` and read \`totalAvailable\` (it ignores \`limit\`). If \`mcp.resultInfo.truncationReason\` is \`'admin-cap'\`, a server cap holds \`totalAvailable\` below the real total: more views exist; page up to \`totalAvailable\` or filter to reach the rest.`,
    paramsSchema,
    annotations: {
      title: 'List Views',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, tagLabels, pageNumber, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const maxResultLimit = configWithOverrides.getMaxResultLimit(listViewsTool.name);

      return await listViewsTool.logAndExecute<ListViewsResult>({
        extra,
        args: { filter, tagLabels, pageNumber, limit },
        callback: async () => {
          const combinedFilter = withContentTagFilter(filter, tagLabels);
          const validatedFilter = combinedFilter
            ? parseAndValidateViewsFilterString(combinedFilter)
            : undefined;
          const pageExceedsLimitMessage = getPageExceedsLimitMessage({
            pageNumber,
            maxResultLimit,
          });
          if (pageExceedsLimitMessage) {
            return new PageExceedsLimitError(pageExceedsLimitMessage).toErr();
          }

          return new Ok(
            await withContentTagResponseValidation(() =>
              useRestApi({
                ...extra,
                // Raw pages precede bounded-context checks.
                disableLogging: true,
                jwtScopes: listViewsTool.requiredApiScopes,
                callback: async (restApi) => {
                  // Fast path: when results are scoped to a specific set of view IDs and the user
                  // hasn't supplied a filter, fetch those views directly instead of paging the whole
                  // site. Query Views for Site has no view-ID filter, so the slow path would fetch
                  // every view only to discard all but the allowed ones. A user filter forces the
                  // slow path since Get View can't apply server-side filtering.
                  const viewIds = configWithOverrides.boundedContext.viewIds;
                  let page: GetPageResult<View>;
                  if (viewIds !== null && !validatedFilter) {
                    const allowedViews = await fetchAllowedViewsById({ restApi, viewIds });
                    page = await getPage({
                      pageNumber,
                      limit,
                      maxResultLimit,
                      getDataFn: async ({ pageSize, pageNumber }) => ({
                        pagination: { pageNumber, pageSize, totalAvailable: allowedViews.length },
                        data: allowedViews.slice(
                          (pageNumber - 1) * pageSize,
                          pageNumber * pageSize,
                        ),
                      }),
                    });
                  } else {
                    page = await getPage({
                      pageNumber,
                      limit,
                      maxResultLimit,
                      getDataFn: async ({ pageSize, pageNumber }) => {
                        const { pagination, views: data } =
                          await restApi.viewsMethods.queryViewsForSite({
                            siteId: restApi.siteId,
                            filter: validatedFilter ?? '',
                            includeUsageStatistics: true,
                            pageSize,
                            pageNumber,
                          });

                        return { pagination, data };
                      },
                    });
                  }

                  const views = page.data;
                  if (configWithOverrides.disableMetadataApiRequests || views.length === 0) {
                    return { ...page, data: flattenViewUsage(views) };
                  }

                  try {
                    const response = await restApi.metadataMethods.graphql(
                      getViewLineageQuery(views.map((view) => view.id)),
                    );
                    return {
                      ...page,
                      data: flattenViewUsage(
                        mergeViewLineage(
                          views,
                          getViewLineageByLuid(response),
                          configWithOverrides.boundedContext.datasourceIds,
                        ),
                      ),
                    };
                  } catch (error) {
                    log(
                      {
                        message: 'Failed to enrich views with lineage metadata',
                        level: 'warning',
                        logger: 'lineage',
                        data: getExceptionMessage(error),
                      },
                      extra,
                    );
                    return { ...page, data: flattenViewUsage(views) };
                  }
                },
              }),
            ),
          );
        },
        constrainSuccessResult: (page) => {
          const constrained = constrainViews({
            views: page.data,
            boundedContext: configWithOverrides.boundedContext,
          });
          if (constrained.type !== 'success') {
            return constrained;
          }
          return {
            type: 'success',
            result: {
              data: constrained.result,
              totalAvailable: page.totalAvailable,
              ...(page.cappedByMaxResultLimit && {
                mcp: {
                  resultInfo: {
                    returnedCount: constrained.result.length,
                    truncated: true,
                    truncationReason: 'admin-cap',
                  },
                },
              }),
            },
          };
        },
      });
    },
  });

  return listViewsTool;
};

export function constrainViews({
  views,
  boundedContext,
}: {
  views: Array<View>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<View>> {
  if (views.length === 0) {
    return {
      type: 'empty',
      message: 'No views were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { projectIds, workbookIds, viewIds, tags } = boundedContext;
  if (viewIds) {
    views = views.filter((view) => viewIds.has(view.id));
  }

  if (projectIds) {
    views = views.filter((view) => (view.project?.id ? projectIds.has(view.project.id) : false));
  }

  if (workbookIds) {
    views = views.filter((view) => (view.workbook?.id ? workbookIds.has(view.workbook.id) : false));
  }

  if (tags) {
    views = views.filter((view) => view.tags?.tag?.some((tag) => tags.has(tag.label)));
  }

  if (views.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed views that can be queried is limited by the server configuration.',
        'While views were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: views,
  };
}

/**
 * Fetches the allowed views directly via Get View, one request per ID. Used when the results are
 * scoped by `INCLUDE_VIEW_IDS` and no user filter is present.
 *
 * Views that return 403 (no permission) or 404 (deleted / not found) are silently omitted so the
 * result matches the slow path, where such views simply never appear in Query Views for Site. Any
 * other failure (5xx, network, etc.) propagates so genuine errors aren't hidden.
 *
 * All views are fetched before the caller pages over them so that omitted (403/404) views are
 * backfilled by other allowed views rather than leaving a page short.
 */
async function fetchAllowedViewsById({
  restApi,
  viewIds,
}: {
  restApi: RestApi;
  viewIds: Set<string>;
}): Promise<Array<View>> {
  const ids = [...viewIds];
  const results = await Promise.allSettled(
    ids.map((viewId) =>
      restApi.viewsMethods.getView({
        siteId: restApi.siteId,
        viewId,
        includeUsageStatistics: true,
      }),
    ),
  );

  const views: Array<View> = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      views.push(result.value);
      return;
    }

    const status = isAxiosError(result.reason) ? result.reason.response?.status : undefined;
    if (status === 403 || status === 404) {
      log({
        message: `Skipping view ${ids[i]} from INCLUDE_VIEW_IDS: not accessible (HTTP ${status})`,
        level: 'warning',
        logger: 'list-views',
      });
      return;
    }

    throw result.reason;
  });

  return views;
}

function flattenViewUsage(views: Array<View>): Array<View> {
  return views.map(({ usage, ...view }) => ({
    ...view,
    totalViewCount: usage?.totalViewCount ?? 0,
  }));
}
