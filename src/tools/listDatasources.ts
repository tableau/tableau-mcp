import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';

export const listDatasourcesTool = new Tool({
  name: 'list-datasources',
  description: `
This tool helps find datasources on a specified Tableau site. It retrieves a list of published data sources from a specified Tableau site using the Tableau REST API. You can optionally filter the results using a filter string in the format \`field:operator:value\` (e.g., \`name:eq:Views\`). This tool supports a wide range of filter fields and operators, enabling precise and flexible queries for data source discovery and automation.

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
- \`cieq\`: case-insensitive equals
- \`eq\`: equals
- \`gt\`: greater than
- \`gte\`: greater than or equal
- \`has\`: includes the specified string (substring search, only for Query Jobs)
- \`in\`: any of [list] (for searching tags)
- \`lt\`: less than
- \`lte\`: less than or equal

**Filter Expression Notes**
- Operators are delimited with colons (:). For example: \`filter=name:eq:Project Views\`
- If any reserved characters following the question mark (?) in the URI are encoded, then all reserved characters must be encoded. For example, \`\` becomes \`%3A\` and \`=\` becomes \`%3D\`.
- Field names, operator names, and values are case-sensitive.
- Values should be URL-encoded. For example, to search for the workbook named "Project Views", use: \`filter=name:eq:Project+Views\`
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
  - filter: "name:eq:Project Views"\`
- List data sources in the "Finance" project:
  - filter: "projectName:eq:Finance"\`
- List data sources created after January 1, 2023:
  - filter: "createdAt:gt:2023-01-01T00:00:00Z"\`
- List data sources with the name "Project Views" in the "Finance" project and created after January 1, 2023:
  - filter: "name:eq:Project Views,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"\`

**Reference:**
For more details, see the [Tableau REST API documentation: Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources).
`,
  paramsSchema: {
    filter: z.string().optional(),
  },
  callback: async ({ filter }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listDatasourcesTool.logAndExecute({
      args: { filter },
      callback: async (requestId) => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return await restApi.datasourcesMethods.listDatasources(restApi.siteId, filter ?? '');
      },
    });
  },
});
