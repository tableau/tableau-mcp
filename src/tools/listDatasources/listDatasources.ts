import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext, getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { DataSource } from '../../sdks/tableau/types/dataSource.js';
import { Server } from '../../server.js';
import { paginate } from '../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, Tool } from '../tool.js';
import { parseAndValidateDatasourcesFilterString } from './datasourcesFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListDatasourcesTool = (server: Server): Tool<typeof paramsSchema> => {
  const listDatasourcesTool = new Tool({
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
  | projectName*           | eq, in                                    |
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
  `,
    paramsSchema,
    annotations: {
      title: 'List Datasources',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, pageSize, limit }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      const validatedFilter = filter ? parseAndValidateDatasourcesFilterString(filter) : undefined;
      return await listDatasourcesTool.logAndExecute({
        requestId,
        args: { filter, pageSize, limit },
        callback: async () => {
          const datasources = await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:content:read'],
            callback: async (restApi) => {
              const datasources = await paginate({
                pageConfig: {
                  pageSize,
                  limit: config.maxResultLimit
                    ? Math.min(config.maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                    : limit,
                },
                getDataFn: async (pageConfig) => {
                  const { pagination, datasources: data } =
                    await restApi.datasourcesMethods.listDatasources({
                      siteId: restApi.siteId,
                      filter: validatedFilter ?? '',
                      pageSize: pageConfig.pageSize,
                      pageNumber: pageConfig.pageNumber,
                    });

                  return { pagination, data };
                },
              });

              return datasources;
            },
          });

          return new Ok(datasources);
        },
        constrainSuccessResult: (datasources) =>
          constrainDatasources({ datasources, boundedContext: config.boundedContext }),
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

  const { projectIds, datasourceIds } = boundedContext;
  if (projectIds) {
    datasources = datasources.filter((datasource) => projectIds.has(datasource.project.id));
  }

  if (datasourceIds) {
    datasources = datasources.filter((datasource) => datasourceIds.has(datasource.id));
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
