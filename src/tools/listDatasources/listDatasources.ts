import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server/server.js';
import { Tool } from '../tool.js';
import { parseAndValidateFilterString } from './datasourcesFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
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
  
  **Supported Operators**
  - \`eq\`: equals
  - \`gt\`: greater than
  - \`gte\`: greater than or equal
  - \`in\`: any of [list] (for searching tags)
  - \`lt\`: less than
  - \`lte\`: less than or equal
  
  **Filter Expression Notes**
  - Filter expressions can't contain ampersand (&) or comma (,) characters even if those characters are encoded.
  - Operators are delimited with colons (:). For example: \`filter=name:eq:Project Views\`
  - Field names, operator names, and values are case-sensitive.
  - To filter on multiple fields, combine expressions using a comma:  \`filter=lastLogin:gte:2016-01-01T00:00:00Z,siteRole:eq:Publisher\`
  - Multiple expressions are combined using a logical AND.
  - If you include the same field multiple times, only the last reference is used.
  - For date-time values, use ISO 8601 format (e.g., \`2016-05-04T21:24:49Z\`).
  - Wildcard searches (starts with, ends with, contains) are supported in recent Tableau versions:
    - Starts with: \`?filter=name:eq:mark*\`
    - Ends with: \`?filter=name:eq:*-ample\`
    - Contains: \`?filter=name:eq:mark*ex*\`
  
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
    callback: async ({ filter }, { requestId, authInfo }): Promise<CallToolResult> => {
      const config = getConfig();
      const validatedFilter = filter ? parseAndValidateFilterString(filter) : undefined;
      return await listDatasourcesTool.logAndExecute({
        requestId,
        authInfo,
        args: { filter },
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              accessToken: authInfo?.token,
              callback: async (restApi) => {
                return await restApi.datasourcesMethods.listDatasources(
                  restApi.siteId,
                  validatedFilter ?? '',
                );
              },
            }),
          );
        },
      });
    },
  });

  return listDatasourcesTool;
};
