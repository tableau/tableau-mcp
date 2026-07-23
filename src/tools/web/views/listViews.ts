import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../../logging/logger.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  getViewLineageByLuid,
  getViewLineageQuery,
  mergeViewLineage,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { View } from '../../../sdks/tableau/types/view.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getPage, MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateViewsFilterString } from './viewsFilterUtils.js';

const paramsSchema = {
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
      'The maximum number of views to return from the requested page (must be <= 1000). Use this to fetch fewer than a full page, e.g. the final partial page a client wants.',
    ),
};

export const getListViewsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listViewsTool = new WebTool({
    server,
    name: 'list-views',
    description: `
  Retrieves a list of views on a Tableau site including their metadata such as name, owner, and the workbook they are found in. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Overview) for precise and flexible view discovery. Use this tool when a user requests to list, search, or filter Tableau views on a site.

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

  **Example Usage:**
  - List all views on a site
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
  Use \`limit\` to return fewer than a full page (at most 1000 items) from the requested page. The response is a flat object \`{ data, totalAvailable }\`; paginate by incrementing \`pageNumber\` until you have collected \`totalAvailable\` items.
  To get just the count of views matching the request, read \`totalAvailable\` from a single call (e.g. \`pageNumber: 1\`) without paging through every item.`,
    paramsSchema,
    annotations: {
      title: 'List Views',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, pageNumber, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateViewsFilterString(filter) : undefined;

      return await listViewsTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: listViewsTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(listViewsTool.name);
                const page = await getPage({
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
                  log({
                    message: 'Failed to enrich views with lineage metadata',
                    level: 'warning',
                    logger: 'lineage',
                    data: getExceptionMessage(error),
                  });
                  return { ...page, data: flattenViewUsage(views) };
                }
              },
            }),
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

function flattenViewUsage(views: Array<View>): Array<View> {
  return views.map(({ usage, ...view }) => ({
    ...view,
    totalViewCount: usage?.totalViewCount ?? 0,
  }));
}
