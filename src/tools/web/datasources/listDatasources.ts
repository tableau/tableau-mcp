import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { DataSource } from '../../../sdks/tableau/types/dataSource.js';
import { WebMcpServer } from '../../../server.web.js';
import { getPage, MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateDatasourcesFilterString } from './datasourcesFilterUtils.js';

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
      'The maximum number of data sources to return from the requested page (must be <= 1000). Use this to fetch fewer than a full page, e.g. the final partial page a client wants.',
    ),
};

export const getListDatasourcesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listDatasourcesTool = new WebTool({
    server,
    name: 'list-datasources',
    description: `
  Retrieves a list of published data sources from a specified Tableau site using the Tableau REST API. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Views) for precise and flexible data source discovery. Use this tool when a user requests to list, search, or filter Tableau data sources on a site.

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

  **Example Usage:**
  - List all data sources on a site
  - List data sources with the name "Project Views":
      filter: "name:eq:Project Views"
  - List data sources in the "Finance" project:
      filter: "projectName:eq:Finance"
  - List data sources created after January 1, 2023:
      filter: "createdAt:gt:2023-01-01T00:00:00Z"
  - List data sources with the name "Project Views" in the "Finance" project and created after January 1, 2023:
      filter: "name:eq:Project Views,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"

  **Pagination**
  This tool returns a single page of up to 1000 data sources per call. Use \`pageNumber\` to select which 1000-item page to fetch (1-based, default 1).
  The response is a flat object \`{ data, totalAvailable }\`. To collect all data sources, increment \`pageNumber\` (starting at 1) until you have collected \`totalAvailable\` items.
  To get just the count of data sources matching the request, read \`totalAvailable\` from a single call (e.g. \`pageNumber: 1\`) without paging through every item.
  `,
    paramsSchema,
    annotations: {
      title: 'List Datasources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, pageNumber, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateDatasourcesFilterString(filter) : undefined;
      return await listDatasourcesTool.logAndExecute({
        extra,
        args: { filter, limit },
        callback: async () =>
          new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: listDatasourcesTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(
                  listDatasourcesTool.name,
                );

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
    datasources = datasources.filter((datasource) => projectIds.has(datasource.project.id));
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
