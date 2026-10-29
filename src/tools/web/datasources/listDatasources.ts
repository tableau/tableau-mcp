import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { PageExceedsLimitError } from '../../../errors/mcpToolError.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { DataSource } from '../../../sdks/tableau/types/dataSource.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
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
import { parseAndValidateDatasourcesFilterString } from './datasourcesFilterUtils.js';

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
      'The maximum number of data sources to return from the requested page (must be <= 1000). Use this to fetch fewer than a full page, e.g. the final partial page a client wants, or `limit: 1` when you only need `totalAvailable` and want to minimize the response payload.',
    ),
};

type ListDatasourcesResult = GetPageResult<DataSource> & {
  mcp?: {
    resultInfo: { returnedCount: number; truncated: true; truncationReason: TruncationReason };
  };
};

export const getListDatasourcesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listDatasourcesTool = new WebTool({
    server,
    name: 'list-datasources',
    minRequiredRole: SiteRole.VIEWER,
    description: `
  Retrieves a list of published data sources from a specified Tableau site using the Tableau REST API. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Views) for precise and flexible data source discovery.
  To list results based on usage popularity or relevance, use the search-content tool instead.

  **Supported Filter Fields and Operators**
  | Field                  | Operators                                 |
  |------------------------|-------------------------------------------|
  | authenticationType     | eq, in                                    |
  | connectedWorkbookType  | eq, gt, gte, lt, lte                      |
  | connectionTo           | eq, in                                    |
  | connectionType         | eq, in                                    |
  | contentUrl             | eq, in                                    |
  | createdAt              | eq, gt, gte, lt, lte                      |
  | databaseName           | eq, in                                    |
  | databaseUserName       | eq, in                                    |
  | description            | eq, in                                    |
  | favoritesTotal         | eq, gt, gte, lt, lte                      |
  | hasAlert               | eq                                        |
  | hasEmbeddedPassword    | eq                                        |
  | hasExtracts            | eq                                        |
  | isCertified            | eq                                        |
  | isConnectable          | eq                                        |
  | isDefaultPort          | eq                                        |
  | isHierarchical         | eq                                        |
  | isPublished            | eq                                        |
  | name                   | eq, in                                    |
  | ownerDomain            | eq, in                                    |
  | ownerEmail             | eq                                        |
  | ownerName              | eq, in                                    |
  | projectName            | eq, in                                    |
  | serverName             | eq, in                                    |
  | serverPort             | eq                                        |
  | size                   | eq, gt, gte, lt, lte                      |
  | tableName              | eq, in                                    |
  | tags                   | eq, in                                    |
  | type                   | eq                                        |
  | updatedAt              | eq, gt, gte, lt, lte                      |

  ${genericFilterDescription}

  **Tag-only discovery**
  ${contentTagSearchDescription}

  **Example Usage:**
  - List data sources with the name "Project Views":
      filter: "name:eq:Project Views"
  - List data sources in the "Finance" project:
      filter: "projectName:eq:Finance"
  - List data sources created after January 1, 2023:
      filter: "createdAt:gt:2023-01-01T00:00:00Z"
  - List data sources with the name "Project Views" in the "Finance" project and created after January 1, 2023:
      filter: "name:eq:Project Views,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"

  **Pagination**
  This tool returns a single 1000-item page per call. Use \`pageNumber\` to select which 1-based page to fetch (default 1).
  The response is a flat object \`{ data, totalAvailable }\`; to collect every data source, keep incrementing \`pageNumber\` until you have gathered \`totalAvailable\` items.
  To count, call once with \`limit: 1\` and read \`totalAvailable\` (it ignores \`limit\`). If \`mcp.resultInfo.truncationReason\` is \`'admin-cap'\`, a server cap holds \`totalAvailable\` below the real total: more data sources exist; page up to \`totalAvailable\` or filter to reach the rest.
  `,
    paramsSchema,
    annotations: {
      title: 'List Datasources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, tagLabels, pageNumber, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const maxResultLimit = configWithOverrides.getMaxResultLimit(listDatasourcesTool.name);
      return await listDatasourcesTool.logAndExecute<ListDatasourcesResult>({
        extra,
        args: { filter, tagLabels, pageNumber, limit },
        callback: async () => {
          const combinedFilter = withContentTagFilter(filter, tagLabels);
          const validatedFilter = combinedFilter
            ? parseAndValidateDatasourcesFilterString(combinedFilter)
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
                // Raw pages precede bounded-context filtering and must not reach debug notifications.
                disableLogging: true,
                jwtScopes: listDatasourcesTool.requiredApiScopes,
                callback: async (restApi) => {
                  const page = await getPage({
                    pageNumber,
                    limit,
                    maxResultLimit,
                    getDataFn: async ({ pageSize, pageNumber }) => {
                      const { pagination, datasources: data } =
                        await restApi.datasourcesMethods.listDatasources({
                          siteId: restApi.siteId,
                          filter: validatedFilter ?? '',
                          pageSize,
                          pageNumber,
                        });

                      return { pagination, data };
                    },
                  });

                  return page;
                },
              }),
            ),
          );
        },
        constrainSuccessResult: (page) => {
          const constrained = constrainDatasources({
            datasources: page.data,
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

  return listDatasourcesTool;
};

export function constrainDatasources({
  datasources,
  boundedContext,
}: {
  datasources: Array<DataSource>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<DataSource>> {
  if (datasources.length === 0) {
    return {
      type: 'empty',
      message:
        'No datasources were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { projectIds, datasourceIds, tags } = boundedContext;
  if (projectIds) {
    datasources = datasources.filter((datasource) => projectIds.has(datasource.project?.id ?? ''));
  }

  if (datasourceIds) {
    datasources = datasources.filter((datasource) => datasourceIds.has(datasource.id));
  }

  if (tags) {
    datasources = datasources.filter((datasource) =>
      datasource.tags.tag?.some((tag) => tags.has(tag.label)),
    );
  }

  if (datasources.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed data sources that can be queried is limited by the server configuration.',
        'While data sources were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: datasources,
  };
}

export const exportedForTesting = {
  listDatasourcesParamsSchema: paramsSchema,
};
